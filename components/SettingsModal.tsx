import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { trpc } from "../trpc/client.ts";
import { get_text, language } from "../islands/Application.tsx";

export function SettingsModal(props: {
    /** Called after the modal is dismissed or a key is saved. */
    onClose: () => void;
    /** Notifies the parent whether a key is now configured (after save/load). */
    onStatusChange?: (hasKey: boolean) => void;
}) {
    const { onClose, onStatusChange } = props;

    const apiKey = useSignal("");
    const masked = useSignal<string | null>(null);
    const saving = useSignal(false);
    const error = useSignal<string | null>(null);

    // Close on Escape, like a native dialog.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        globalThis.addEventListener("keydown", onKeyDown);
        return () => globalThis.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    // Load the current key status to show whether one is already set.
    useEffect(() => {
        (async () => {
            try {
                const status = await trpc.getApiKeyStatus.query();
                masked.value = status.masked;
            } catch (err) {
                console.error(err);
            }
        })();
    }, []);

    const save = async () => {
        const key = apiKey.value.trim();
        if (!key) {
            error.value = get_text("please_enter_an_api_key", language.value);
            return;
        }
        saving.value = true;
        error.value = null;
        try {
            const res = await trpc.setApiKey.mutate({ apiKey: key });
            masked.value = res.masked;
            onStatusChange?.(res.hasKey);
            onClose();
        } catch (err) {
            console.error(err);
            error.value = err instanceof Error
                ? err.message
                : get_text("save_failed", language.value);
        } finally {
            saving.value = false;
        }
    };

    return (
        <div
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div class="relative w-full max-w-md rounded-2xl bg-white text-gray-800 shadow-2xl">
                <button
                    type="button"
                    aria-label={get_text("close", language.value)}
                    onClick={onClose}
                    class="absolute top-3 right-3 size-8 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center hover:cursor-pointer transition-colors"
                >
                    <CloseIcon class="size-4" />
                </button>

                <div class="p-6 space-y-4">
                    <div>
                        <h2 class="text-lg font-semibold">
                            {get_text("settings", language.value)}
                        </h2>
                        <p class="text-sm text-gray-500 mt-0.5">
                            {get_text(
                                "configure_seedance_api_key",
                                language.value,
                            )}
                        </p>
                    </div>

                    <div class="space-y-1.5">
                        <label class="block text-sm font-medium text-gray-700">
                            Seedance API Key
                        </label>
                        {masked.value && (
                            <p class="text-[11px] text-gray-500">
                                {get_text("currently_saved", language.value)}
                                {" "}
                                <span class="font-mono">
                                    {masked.value}
                                </span>
                            </p>
                        )}
                        <input
                            type="password"
                            autoComplete="off"
                            spellcheck={false}
                            value={apiKey.value}
                            placeholder={masked.value
                                ? get_text(
                                    "enter_a_new_key_to_replace_it",
                                    language.value,
                                )
                                : "ark-..."}
                            onInput={(e) =>
                                apiKey.value = (e.target as HTMLInputElement)
                                    .value}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") save();
                            }}
                            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                        />
                        {error.value && (
                            <p class="text-[11px] text-red-500">
                                {error.value}
                            </p>
                        )}
                    </div>

                    <div class="flex justify-end gap-2 pt-1">
                        <button
                            type="button"
                            onClick={onClose}
                            class="px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 hover:cursor-pointer transition-colors"
                        >
                            {get_text("cancel", language.value)}
                        </button>
                        <button
                            type="button"
                            onClick={save}
                            disabled={saving.value}
                            class="px-3 py-1.5 rounded-lg text-sm bg-indigo-500 text-white hover:bg-indigo-600 hover:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {saving.value
                                ? get_text("saving", language.value)
                                : get_text("save", language.value)}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function CloseIcon(props: { class?: string }) {
    return (
        <svg
            class={props.class ?? "size-4"}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </svg>
    );
}
