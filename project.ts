import { join } from "@std/path";
import { getStoredProjectPath } from "./kv.ts";

const WINDOWS_FOLDER_PICKER_SCRIPT = String.raw`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[ComImport]
[Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
class FileOpenDialog
{
}

[ComImport]
[Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItem
{
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdnName, out IntPtr ppszName);
    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
    void Compare(IShellItem psi, uint hint, out int piOrder);
}

[ComImport]
[Guid("42F85136-DB7E-439C-85F1-E4075D135FC8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IFileOpenDialog
{
    [PreserveSig]
    int Show(IntPtr parent);
    void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
    void SetFileTypeIndex(uint iFileType);
    void GetFileTypeIndex(out uint piFileType);
    void Advise(IntPtr pfde, out uint pdwCookie);
    void Unadvise(uint dwCookie);
    void SetOptions(uint fos);
    void GetOptions(out uint pfos);
    void SetDefaultFolder(IShellItem psi);
    void SetFolder(IShellItem psi);
    void GetFolder(out IShellItem ppsi);
    void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetFileName(out IntPtr pszName);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi);
    void AddPlace(IShellItem psi, uint fdap);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
    void Close(int hr);
    void SetClientGuid(ref Guid guid);
    void ClearClientData();
    void SetFilter(IntPtr pFilter);
    void GetResults(out IntPtr ppenum);
    void GetSelectedItems(out IntPtr ppsai);
}

public static class FolderPicker
{
    const int ERROR_CANCELLED = unchecked((int)0x800704C7);
    const int E_ACCESSDENIED = unchecked((int)0x80070005);
    const int PROCESS_PER_MONITOR_DPI_AWARE = 2;
    const uint FOS_PICKFOLDERS = 0x00000020;
    const uint FOS_FORCEFILESYSTEM = 0x00000040;
    const uint FOS_PATHMUSTEXIST = 0x00000800;
    const uint SIGDN_FILESYSPATH = 0x80058000;
    static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);

    [DllImport("user32.dll")]
    static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("shcore.dll")]
    static extern int SetProcessDpiAwareness(int awareness);

    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    public static void EnableDpiAwareness()
    {
        try
        {
            if (SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2))
            {
                return;
            }
        }
        catch
        {
        }

        try
        {
            int hr = SetProcessDpiAwareness(PROCESS_PER_MONITOR_DPI_AWARE);
            if (hr == 0 || hr == E_ACCESSDENIED)
            {
                return;
            }
        }
        catch
        {
        }

        try
        {
            SetProcessDPIAware();
        }
        catch
        {
        }
    }

    public static string Pick()
    {
        object dialogObject = new FileOpenDialog();
        IFileOpenDialog dialog = (IFileOpenDialog)dialogObject;
        IShellItem item = null;
        IntPtr pathPtr = IntPtr.Zero;

        try
        {
            uint options;
            dialog.GetOptions(out options);
            dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
            dialog.SetTitle("Select project folder");

            int hr = dialog.Show(IntPtr.Zero);
            if (hr == ERROR_CANCELLED)
            {
                return null;
            }
            if (hr != 0)
            {
                Marshal.ThrowExceptionForHR(hr);
            }

            dialog.GetResult(out item);
            item.GetDisplayName(SIGDN_FILESYSPATH, out pathPtr);
            return Marshal.PtrToStringUni(pathPtr);
        }
        finally
        {
            if (pathPtr != IntPtr.Zero)
            {
                Marshal.FreeCoTaskMem(pathPtr);
            }
            if (item != null)
            {
                Marshal.ReleaseComObject(item);
            }
            Marshal.ReleaseComObject(dialogObject);
        }
    }
}
"@

[FolderPicker]::EnableDpiAwareness()
$path = [FolderPicker]::Pick()
if ($path) {
    [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($path))
}
`;

/**
 * Resolve a project-relative path to an absolute one, rejecting traversal.
 * @deprecated
 */
export async function resolveInProject_deprecated(sub: string) {
    if (sub.includes("..")) throw new Error("Path may not contain '..'");
    const root = await getStoredProjectPath();
    return sub ? `${root}/${sub}` : root;
}

export function resolveInProject(projectRoot: string, path: string) {
    if (path.includes("..")) {
        return new Error("Path may not contain '..'");
    }
    return join(projectRoot, path);
}

/**
 * Open a native OS folder picker and return the chosen absolute path, or null
 * if the user cancelled (or no picker tool is available). Runs server-side, so
 * the dialog appears on the machine hosting the backend.
 */
export async function pickProjectFolder(): Promise<string | null> {
    const command = (() => {
        switch (Deno.build.os) {
            case "darwin":
                return new Deno.Command("osascript", {
                    args: [
                        "-e",
                        'POSIX path of (choose folder with prompt "选择项目文件夹")',
                    ],
                });
            case "windows":
                return new Deno.Command("powershell", {
                    args: [
                        "-NoProfile",
                        "-STA",
                        "-Command",
                        WINDOWS_FOLDER_PICKER_SCRIPT,
                    ],
                });
            default: // linux & others — needs `zenity` installed
                return new Deno.Command("zenity", {
                    args: [
                        "--file-selection",
                        "--directory",
                        "--title=选择项目文件夹",
                    ],
                });
        }
    })();

    const { success, stdout } = await command.output();
    if (!success) return null; // cancelled, or the picker tool is missing
    const out = new TextDecoder().decode(stdout).trim();
    if (!out) return null;
    const path = Deno.build.os === "windows"
        ? new TextDecoder().decode(
            Uint8Array.from(atob(out), (char) => char.charCodeAt(0)),
        )
        : out;
    // macOS `POSIX path` has a trailing slash; trim it (but keep root "/").
    console.log("pickProjectFolder", path);
    return path.length > 1 ? path.replace(/\/+$/, "") : path;
}
