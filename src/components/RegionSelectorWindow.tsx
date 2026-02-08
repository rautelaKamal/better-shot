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
                // Call backend to crop the screenshot
                const croppedPath = await invoke<string>("capture_region", {
                    screenshotPath: screenshotData.screenshotPath,
                    x: Math.round(region.x),
                    y: Math.round(region.y),
                    width: Math.round(region.width),
                    height: Math.round(region.height),
                    saveDir: "", // Will use temp dir or get from settings
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
            // Clean up temp screenshot file
            if (screenshotData?.screenshotPath) {
                await invoke("cleanup_temp_file", {
                    path: screenshotData.screenshotPath,
                });
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
