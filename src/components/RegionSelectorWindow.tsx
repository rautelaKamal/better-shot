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
        const configureWindow = async () => {
            try {
                const win = getCurrentWindow();
                await Promise.all([
                    win.setAlwaysOnTop(true),
                    win.setFullscreen(true),
                    win.setResizable(false),
                    win.setDecorations(false),
                ]);
                setIsReady(true);
            } catch (error) {
                console.error("[RegionSelectorWindow] Failed to configure region selector window:", error);
            }
        };

        configureWindow();
    }, []);

    useEffect(() => {
        let unlisten: (() => void) | undefined;
        let mounted = true;

        const setupListener = async () => {
            try {
                const unlistenFn = await listen<RegionSelectorEventPayload>(
                    "region-selector-show",
                    (event) => {
                        if (mounted) {
                            setScreenshotData(event.payload);
                        }
                    }
                );

                if (mounted) {
                    unlisten = unlistenFn;
                } else {
                    unlistenFn();
                }
            } catch (error) {
                console.error("[RegionSelectorWindow] Failed to set up event listener:", error);
            }
        };

        setupListener();

        return () => {
            mounted = false;
            if (unlisten) {
                unlisten();
            }
        };
    }, []);

    const handleSelect = useCallback(
        async (region: { x: number; y: number; width: number; height: number }) => {
            if (!screenshotData) return;

            try {
                const centerX = region.x + region.width / 2;
                const centerY = region.y + region.height / 2;

                if (screenshotData.monitorShots.length === 0) {
                    throw new Error("No monitor screenshots available");
                }

                // Find which monitor the selection center is on
                const targetShot =
                    screenshotData.monitorShots.find((s) => {
                        return (
                            centerX >= s.x &&
                            centerX <= s.x + s.width &&
                            centerY >= s.y &&
                            centerY <= s.y + s.height
                        );
                    }) ?? screenshotData.monitorShots[0];

                // Calculate local coordinates relative to that monitor with clamping
                // This ensures we never send negative or out-of-bounds coordinates to the backend
                const unclampedX = region.x - targetShot.x;
                const unclampedY = region.y - targetShot.y;

                const localX = Math.min(Math.max(0, unclampedX), targetShot.width);
                const localY = Math.min(Math.max(0, unclampedY), targetShot.height);

                // Calculate width/height ensuring we don't go past the edge of the screenshot
                const localWidth = Math.max(0, Math.min(region.width, targetShot.width - localX));
                const localHeight = Math.max(0, Math.min(region.height, targetShot.height - localY));

                const scale = targetShot.scale_factor;

                // Derive save directory from the target shot path
                let saveDir = "";
                const lastSepIndex = Math.max(targetShot.path.lastIndexOf("/"), targetShot.path.lastIndexOf("\\"));
                if (lastSepIndex !== -1) {
                    saveDir = targetShot.path.substring(0, lastSepIndex);
                }

                // Call backend to crop from the SPECIFIC monitor's screenshot
                const croppedPath = await invoke<string>("capture_region", {
                    screenshotPath: targetShot.path,
                    x: Math.round(localX * scale),
                    y: Math.round(localY * scale),
                    width: Math.round(localWidth * scale),
                    height: Math.round(localHeight * scale),
                    saveDir: saveDir,
                });

                // Clean up ALL temp monitor screenshots now that we have the crop
                await Promise.all(
                    screenshotData.monitorShots.map((shot) =>
                        invoke("cleanup_temp_file", { path: shot.path }).catch((e) =>
                            console.error("Failed to cleanup file:", shot.path, e)
                        )
                    )
                );

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
