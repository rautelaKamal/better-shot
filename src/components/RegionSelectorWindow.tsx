import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { RegionSelector } from "./RegionSelector";

type RegionSelectorEventPayload = {
    screenshotPath: string;
    monitorShots: Array<{
        id: number;
        x: number;
        y: number;
        width: number;
        height: number;
        scale_factor: number;
        path: string;
    }>;
};

export function RegionSelectorWindow() {
    const [screenshotData, setScreenshotData] = useState<RegionSelectorEventPayload | null>(null);
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        console.log("[RegionSelectorWindow] Component mounted, configuring window...");
        const configureWindow = async () => {
            try {
                console.log("[RegionSelectorWindow] Getting current window...");
                const win = getCurrentWindow();
                console.log("[RegionSelectorWindow] Window obtained, setting properties...");
                await Promise.all([
                    win.setAlwaysOnTop(true),
                    win.setFullscreen(true),
                    win.setResizable(false),
                    win.setDecorations(false),
                ]);
                console.log("[RegionSelectorWindow] Window configured successfully, setting isReady=true");
                setIsReady(true);
            } catch (error) {
                console.error("[RegionSelectorWindow] Failed to configure region selector window:", error);
            }
        };

        configureWindow();
    }, []);

    useEffect(() => {
        console.log("[RegionSelectorWindow] Setting up event listener for 'region-selector-show'...");
        let unlisten: (() => void) | undefined;

        const setupListener = async () => {
            try {
                unlisten = await listen<RegionSelectorEventPayload>(
                    "region-selector-show",
                    (event) => {
                        console.log("[RegionSelectorWindow] ✅ Event received!", event.payload);
                        console.log("[RegionSelectorWindow] Monitor shots count:", event.payload.monitorShots?.length);
                        setScreenshotData(event.payload);
                    }
                );
                console.log("[RegionSelectorWindow] Event listener set up successfully");
            } catch (error) {
                console.error("[RegionSelectorWindow] Failed to set up event listener:", error);
            }
        };

        setupListener();

        return () => {
            if (unlisten) {
                unlisten();
            }
        };
    }, []);

    const handleSelect = useCallback(
        async (region: { x: number; y: number; width: number; height: number }) => {
            if (!screenshotData) return;

            try {
                // Derive save directory from the screenshot path to ensure we write to a valid temp location
                // The screenshotPath is already in a valid temp dir
                const monitorShot = screenshotData.monitorShots.find(s => s.path === screenshotData.screenshotPath) || screenshotData.monitorShots[0];
                // We'll pass the directory of the monitor shot. 
                // However, the backend's capture_region expects a directory to save TO.
                // If we pass empty string, it saves to CWD which is bad.
                // We can construct the path using a known safe directory if possible, but we don't have direct fs access here easily.
                // Best effort: extract directory from the path.
                // Since we can't use node's path module, we do string manipulation.
                // Assume standard path separators.
                let saveDir = "";
                const lastSepIndex = Math.max(monitorShot.path.lastIndexOf("/"), monitorShot.path.lastIndexOf("\\"));
                if (lastSepIndex !== -1) {
                    saveDir = monitorShot.path.substring(0, lastSepIndex);
                }

                // Call backend to crop the screenshot
                const croppedPath = await invoke<string>("capture_region", {
                    screenshotPath: screenshotData.screenshotPath,
                    x: Math.round(region.x),
                    y: Math.round(region.y),
                    width: Math.round(region.width),
                    height: Math.round(region.height),
                    saveDir: saveDir,
                });

                // Emit event back to main window with the cropped image path
                await invoke("emit_capture_complete", {
                    path: croppedPath,
                });

                // Close this window
                const win = getCurrentWindow();
                await win.close();
            } catch (error) {
                console.error("Failed to capture region:", error);
                // TODO: Show error UI
            }
        },
        [screenshotData]
    );

    const handleCancel = useCallback(async () => {
        try {
            // Clean up all temp screenshot files
            if (screenshotData?.monitorShots) {
                await Promise.all(
                    screenshotData.monitorShots.map(shot =>
                        invoke("cleanup_temp_file", { path: shot.path }).catch(e => console.error("Failed to cleanup file:", shot.path, e))
                    )
                );
            }

            // Restore main window
            await invoke("restore_main_window");

            // Close this window
            const win = getCurrentWindow();
            await win.close();
        } catch (error) {
            console.error("Failed to cancel region selection:", error);
        }
    }, [screenshotData]);

    if (!isReady || !screenshotData) {
        console.log("[RegionSelectorWindow] Showing loading state. isReady:", isReady, "hasData:", !!screenshotData);
        return (
            <div className="flex size-full items-center justify-center bg-black">
                <div className="size-12 animate-spin rounded-full border-4 border-white/20 border-t-white" />
            </div>
        );
    }

    return (
        <RegionSelector
            onSelect={handleSelect}
            onCancel={handleCancel}
            monitorShots={screenshotData.monitorShots}
        />
    );
}
