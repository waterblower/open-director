/// <reference lib="deno.desktop" />

const window = new Deno.BrowserWindow();
window.setApplicationMenu([
    {
        submenu: {
            label: "Open Director",
            items: [
                { role: { role: "quit" } },
            ],
        },
    },
    {
        submenu: {
            label: "Edit",
            items: [
                { role: { role: "undo" } },
                { role: { role: "redo" } },
                "separator",
                { role: { role: "cut" } },
                { role: { role: "copy" } },
                { role: { role: "paste" } },
                { role: { role: "selectAll" } },
            ],
        },
    },
    {
        submenu: {
            label: "View",
            items: [
                {
                    item: {
                        id: "developer-tools",
                        label: "Developer Tools",
                        accelerator: "CmdOrCtrl+Alt+I",
                        enabled: true,
                    },
                },
            ],
        },
    },
]);

window.addEventListener("menuclick", (event) => {
    if (event.detail.id === "developer-tools") {
        window.openDevtools({ deno: false });
    }
});

window.addEventListener("close", () => {
    Deno.exit(0);
});
