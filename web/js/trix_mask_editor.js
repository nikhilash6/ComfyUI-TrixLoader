import { app } from '../../../scripts/app.js';
import { api } from '../../../scripts/api.js';
import { openTrixCropEditor } from './trix_crop_editor.js';

const TRIX_ACCENT = "#33789a";
const TRIX_ACCENT_HOVER = "#3f8eb4";
const TRIX_BUTTON_BG = "#2a2a2f";
const TRIX_BUTTON_HOVER = "#333a45";
const TRIX_PANEL_BG = "#151515";

function getDecontUrl(src) {
    if (!src) return null;
    if (src.startsWith("data:") || src.startsWith("blob:") || src.startsWith("http:") || src.startsWith("https:") || src.startsWith("/")) {
        return src;
    }
    return `/view?filename=${encodeURIComponent(src)}&type=input&t=${Date.now()}`;
}

export function openTrixMaskEditor(node) {
    node._isUIBlocked = false;
    
    if (!node.imgTagRef || !node.imgTagRef.naturalWidth) {
        alert("Please load an image first!");
        return;
    }

    const getSAMImageParam = () => {
        const src = node.imgTagRef.src;
        if (!src) return node.widgets.find(w => w.name === "image")?.value || "";
        
        try {
            const url = new URL(src, window.location.origin);
            const filename = url.searchParams.get("filename");
            const subfolder = url.searchParams.get("subfolder");
            const type = url.searchParams.get("type") || "input";
            if (filename) {
                const baseName = subfolder ? `${subfolder}/${filename}` : filename;
                if (type === "temp") return `${baseName} [temp]`;
                if (type === "output") return `${baseName} [output]`;
                return `${baseName} [input]`;
            }
        } catch (e) {
            console.error("Failed to parse imgTagRef.src URL", e);
        }
        
        return node.widgets.find(w => w.name === "image")?.value || "";
    };

    const abortCtrl = new AbortController();
    const signal = abortCtrl.signal;

    // Save previous state for revert/cancel/exit
    const originalMaskData = (node.widgets && node.widgets.find(w => w.name === "mask_data")?.value) || "";
    let originalMaskSrc = "";
    let initialDecontSrc = null;
    if (originalMaskData) {
        if (originalMaskData.startsWith("{")) {
            try {
                const parsed = JSON.parse(originalMaskData);
                originalMaskSrc = parsed.mask || "";
                initialDecontSrc = parsed.decont_image || null;
            } catch (e) {
                console.error("Failed to parse mask JSON", e);
                originalMaskSrc = originalMaskData;
            }
        } else {
            originalMaskSrc = originalMaskData;
        }
    }

    // Editor State variables (declared at top to prevent TDZ ReferenceErrors)
    let history = [];
    let historyIndex = -1;
    if (node.history && node.history.length > 0) {
        history = node.history.map(state => {
            if (typeof state === "string" && state.startsWith("{")) {
                try {
                    const parsed = JSON.parse(state);
                    return {
                        mask: parsed.mask || "",
                        decontImage: parsed.decont_image || null
                    };
                } catch(e) {
                    return { mask: state, decontImage: null };
                }
            } else if (typeof state === "string") {
                return { mask: state, decontImage: null };
            }
            return state;
        });
        historyIndex = node.historyIndex !== undefined ? node.historyIndex : history.length - 1;
    }
    let currentDecontImgB64 = initialDecontSrc;
    let currentDecontImg = null;
    if (initialDecontSrc) {
        currentDecontImg = new Image();
        currentDecontImg.src = getDecontUrl(initialDecontSrc);
    }
    let isEraser = false;
    let brushSize = node.brushSize !== undefined ? parseFloat(node.brushSize) : 50;
    let brushHardness = node.brushHardness !== undefined ? parseFloat(node.brushHardness) : 1.0;
    const colorsList = ["#FF0000", "#00FF00", "#FFFFFF", "#000000"];
    let colorIndex = node._colorIdx !== undefined ? node._colorIdx : 0;
    let maskColor = colorsList[colorIndex];
    const camera = { x: 0, y: 0, zoom: 1.0 };
    let isFirstLaunch = true;
    let lastContainerW = 0;
    let lastContainerH = 0;
    node._maskFiltersDirty = true;
    let isPanning = false;
    let isDrawing = false;
    let startMx = 0;
    let startMy = 0;
    let lastLp = null;
    let currentMouseImgPos = null;
    let showMask = true;
    let isDrawingRAF = false;
    let samRmbDrawing = false;
    let samRmbPoints = [];
    let isDownloadingSAM = false;
    let isDownloadingBG = false;

    const beforeUnloadHandler = (e) => {
        if (isDownloadingSAM || isDownloadingBG) {
            e.preventDefault();
            e.returnValue = "Please wait for the model download to complete. Do not close the editor or reload the page.";
            return e.returnValue;
        }
    };
    window.addEventListener("beforeunload", beforeUnloadHandler);

    // SAM Hover Preview State Variables
    let samHoverCanvas = null;
    let samHoverCoords = null; // { x, y }
    let samHoverAbortCtrl = null;
    let samHoverTimeout = null;

    let recenterBtn = null;
    let updateRecenterBtnText = null;
    let baseFitScale = 1;

    const TRIX_AIO_SUBFOLDER = "aio_input";
    const trixCropSafeId = (value) => String(value ?? "node").replace(/[^a-zA-Z0-9_-]+/g, "_") || "node";
    const trixEditedFilename = (nodeId) => `trix_edited_${trixCropSafeId(nodeId)}.png`;

    const clearSAMHover = () => {
        if (samHoverTimeout) {
            clearTimeout(samHoverTimeout);
            samHoverTimeout = null;
        }
        if (samHoverAbortCtrl) {
            samHoverAbortCtrl.abort();
            samHoverAbortCtrl = null;
        }
        samHoverCanvas = null;
        samHoverCoords = null;
    };

    // Additional state variables for keyboard & mouse interactions
    let resizingBrush = false;
    let resizeStartX = 0;
    let resizeStartY = 0;
    let accumulatedMovementX = 0;
    let accumulatedMovementY = 0;
    let initialBrushSize = 50;
    let initialBrushHardness = 1.0;
    let resizeAxisLock = null;

    let wasShiftDrawing = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let shiftLockAxis = null;
    let lastClickPos = null;
    
    // Inject custom scrollbar and range slider styles if not already present
    if (!document.getElementById("trix-mask-editor-styles")) {
        const style = document.createElement("style");
        style.id = "trix-mask-editor-styles";
        style.innerHTML = `
            .trix-sidebar::-webkit-scrollbar {
                width: 6px;
            }
            .trix-sidebar::-webkit-scrollbar-track {
                background: transparent;
            }
            .trix-sidebar::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.15);
                border-radius: 3px;
            }
            .trix-sidebar::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.25);
            }
            .trix-slider {
                -webkit-appearance: none;
                width: 100%;
                height: 4px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 2px;
                outline: none;
                transition: all 0.2s;
                flex-shrink: 0;
            }
            .trix-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                background: ${TRIX_ACCENT};
                cursor: pointer;
                transition: transform 0.1s;
            }
            .trix-slider::-webkit-slider-thumb:hover {
                transform: scale(1.2);
                background: ${TRIX_ACCENT_HOVER};
            }
            @keyframes trix-border-pulse {
                0% {
                    border-color: rgba(51, 120, 154, 0.35);
                    box-shadow: 0 0 4px rgba(51, 120, 154, 0.2);
                }
                50% {
                    border-color: rgba(51, 120, 154, 1.0);
                    box-shadow: 0 0 12px rgba(51, 120, 154, 0.75);
                }
                100% {
                    border-color: rgba(51, 120, 154, 0.35);
                    box-shadow: 0 0 4px rgba(51, 120, 154, 0.2);
                }
            }
            .trix-shimmer-plaque {
                background: #121820 !important;
                border: 1px solid rgba(51, 120, 154, 0.6) !important;
                animation: trix-border-pulse 2s ease-in-out infinite !important;
                padding-right: 35px !important;
                min-width: 220px !important;
            }
            .trix-thresh-input::-webkit-outer-spin-button,
            .trix-thresh-input::-webkit-inner-spin-button {
                -webkit-appearance: none;
                margin: 0;
            }
            .trix-thresh-input {
                -moz-appearance: textfield;
            }
        `;
        document.head.appendChild(style);
    }

    // Create the overlay container
    const overlay = document.createElement("div");
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background-color: #0d0e12;
        z-index: 10000; display: flex; font-family: sans-serif; user-select: none;
    `;
    overlay.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    // Blocker overlay for UI interaction lock
    const blockerOverlay = document.createElement("div");
    blockerOverlay.style.cssText = `
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background-color: rgba(0, 0, 0, 0.2);
        z-index: 20000; cursor: wait; display: none;
    `;
    overlay.appendChild(blockerOverlay);

    const lockUI = () => {
        node._isUIBlocked = true;
        blockerOverlay.style.display = "block";
    };

    const unlockUI = () => {
        node._isUIBlocked = false;
        blockerOverlay.style.display = "none";
    };

    // Sidebar Container (Left Panel) with glassmorphism
    const sidebar = document.createElement("div");
    sidebar.className = "trix-sidebar";
    sidebar.style.cssText = `
        position: relative;
        width: 280px; height: 100%; flex-shrink: 0;
        background: #151515;
        border-right: 1px solid #333;
        display: flex; flex-direction: column; padding: 20px; box-sizing: border-box;
        box-shadow: 2px 0 10px rgba(0,0,0,0.5); z-index: 10; overflow-y: auto;
    `;

    // Sidebar blocker overlay for model downloading
    const sidebarBlocker = document.createElement("div");
    sidebarBlocker.style.cssText = `
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background-color: rgba(20, 20, 20, 0.85);
        z-index: 10000; cursor: wait; display: none;
        border-radius: inherit;
        backdrop-filter: blur(4px);
        box-sizing: border-box;
        padding: 30px 20px;
        flex-direction: column;
        justify-content: center;
        align-items: center;
    `;
    const sidebarBlockerText = document.createElement("div");
    sidebarBlockerText.style.cssText = "width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;";
    sidebarBlocker.appendChild(sidebarBlockerText);
    sidebar.appendChild(sidebarBlocker);

    const sidebarTitle = document.createElement("div");
    sidebarTitle.style.cssText = "color: #fff; font-size: 16px; font-weight: bold; margin-bottom: 20px; flex-shrink: 0; display: flex; align-items: center;";
    sidebarTitle.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px; color: ${TRIX_ACCENT}; flex-shrink: 0;">
            <path d="M15 4V2"></path>
            <path d="M15 16v-2"></path>
            <path d="M8 9H6"></path>
            <path d="M20 9h-2"></path>
            <path d="M19.07 4.93l-1.41 1.41"></path>
            <path d="M6.34 17.66l-1.41 1.41"></path>
            <path d="M19.07 13.07l-1.41-1.41"></path>
            <path d="M6.34 6.34l-1.41 1.41"></path>
            <path d="M14 9.5L5.5 18a1.5 1.5 0 0 0 2 2L16 11.5z"></path>
        </svg> Advanced Mask Tools
    `;
    sidebar.appendChild(sidebarTitle);

    // ==========================================
    // TOOLBAR STYLING UTILITIES
    // ==========================================
    const createSidebarLabel = (text, tooltip = "") => {
        const lbl = document.createElement("div");
        lbl.innerText = text;
        lbl.style.cssText = "color: #8c8e96; font-size: 10px; font-weight: 700; margin-top: 18px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; flex-shrink: 0;";
        if (tooltip) lbl.title = tooltip;
        return lbl;
    };

    const createSidebarSelect = (options) => {
        const sel = document.createElement("select");
        sel.style.cssText = `
            background: #000;
            color: #fff;
            border: 1px solid #444;
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 12px;
            cursor: pointer;
            width: 100%;
            box-sizing: border-box;
            outline: none;
            margin-bottom: 12px;
            flex-shrink: 0;
            transition: all 0.2s;
        `;
        sel.onfocus = () => {
            sel.style.borderColor = TRIX_ACCENT;
            sel.style.boxShadow = "0 0 0 2px rgba(51, 120, 154, 0.2)";
        };
        sel.onblur = () => {
            sel.style.borderColor = "#444";
            sel.style.boxShadow = "none";
        };
        options.forEach(opt => {
            const o = document.createElement("option");
            o.value = opt.value;
            o.innerText = opt.text;
            o.style.background = "#151515";
            sel.appendChild(o);
        });
        return sel;
    };

    const createSidebarButton = (text, primary = false, toggleable = false) => {
        const btn = document.createElement("button");
        btn.innerText = text;
        btn.isActive = false;
        
        const updateStyle = () => {
            if (toggleable && btn.isActive) {
                btn.style.background = TRIX_ACCENT;
                btn.style.borderColor = TRIX_ACCENT;
                btn.style.color = "#fff";
            } else {
                btn.style.background = primary ? TRIX_ACCENT : "#2a2a2f";
                btn.style.borderColor = primary ? "transparent" : "#444";
                btn.style.color = primary ? "#fff" : "#ccc";
            }
        };

        btn.style.cssText = `
            width: 100%; padding: 10px 14px; border-radius: 6px; font-weight: bold;
            font-size: 12px; cursor: pointer; transition: all 0.2s;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            margin-bottom: 16px; flex-shrink: 0;
            border: 1px solid ${primary ? "transparent" : "#444"};
        `;
        updateStyle();

        btn.onmouseenter = () => {
            if (toggleable && btn.isActive) {
                btn.style.background = TRIX_ACCENT_HOVER;
                btn.style.color = "#fff";
            } else if (primary) {
                btn.style.background = TRIX_ACCENT_HOVER;
                btn.style.color = "#fff";
            } else {
                btn.style.background = "#333a45";
                btn.style.color = "#fff";
            }
        };
        btn.onmouseleave = () => {
            updateStyle();
        };
        
        btn.updateSidebarBtnStyle = updateStyle;
        return btn;
    };

    // ==========================================
    // SIDEBAR: ADVANCED AI TOOLS BLOCK
    // ==========================================
    const advancedBlock = document.createElement("div");
    advancedBlock.style.cssText = `
        border: 1px solid #444;
        background: #1a1a1a;
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex-shrink: 0;
        position: relative;
        box-shadow: inset 0 1px 2px rgba(0,0,0,0.4);
    `;

    // Advanced AI Tools Title + Info icon Row
    const advancedHeader = document.createElement("div");
    advancedHeader.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; flex-shrink: 0;";
    
    const advancedTitle = document.createElement("span");
    advancedTitle.innerText = "Advanced AI Tools";
    advancedTitle.style.cssText = "color: #fff; font-size: 12px; font-weight: bold; letter-spacing: 0.5px;";
    
    // Info Icon and Tooltip
    const infoIcon = document.createElement("div");
    infoIcon.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="cursor: pointer; color: ${TRIX_ACCENT};">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
    `;
    infoIcon.style.cssText = "position: relative; display: flex; align-items: center; justify-content: center;";
    infoIcon.title = `Advanced Mask Tools Help:

1. SAM (Segment Anything)
• Models: SAM 2.1, SAM 2, SAM 1
• Path: "models/sams/"
• Object Selector: Click to auto-segment.
  - LMB: Add positive points (green) to select objects.
  - RMB + Drag: Draw negative lines/points (red) to exclude areas.
• PRO Mode: Refines output by compiling multiple click points, reducing salt-and-pepper noise, and filtering out disconnected background islands.
• Shortkeys:
  - [ / ]: Decrease / Increase brush size
  - Alt + RMB (Drag): Horizontal for brush size, Vertical for hardness
  - X: Toggle Brush / Eraser
  - Space + LMB (or Middle Click): Pan canvas
  - Mouse Wheel: Zoom canvas
  - Ctrl + Z / Ctrl + Y: Undo / Redo
  - Enter / Escape: Save & Close

2. Mask Background
• Models: RMBG-2.0, RMBG-1.4, BiRefNet, etc.
• Path: "models/RMBG/"
• Alpha Matting: Computes soft, transparent edge transitions (great for hair/fur).

3. Post-Processing Sliders
• Grow: Dilates (extends) or erodes (contracts) the mask boundaries.
• Blur: Softens edges using a Gaussian filter.
• Fill Holes: Fills internal unmasked gaps and holes.
• Smooth: Cleans up jagged outlines and removes small noise artifacts.`;
    
    advancedHeader.append(advancedTitle, infoIcon);
    advancedBlock.appendChild(advancedHeader);

    // Separator line
    const advSeparator = document.createElement("div");
    advSeparator.style.cssText = "height: 1px; background: #333; margin-bottom: 6px; flex-shrink: 0;";
    advancedBlock.appendChild(advSeparator);

    // SAM Label Container & Device Select
    const samLabelContainer = document.createElement("div");
    samLabelContainer.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-top: 18px; margin-bottom: 8px; flex-shrink: 0;";

    const samLabel = document.createElement("div");
    samLabel.innerText = "Object Selector (SAM)";
    samLabel.style.cssText = "color: #8c8e96; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin: 0;";
    samLabel.title = "Click objects on the image to automatically mask them.";

    const samDeviceSelect = document.createElement("select");
    samDeviceSelect.style.cssText = "background: transparent; color: #fff; border: none; font-size: 10px; font-weight: bold; cursor: pointer; text-decoration: underline; padding: 0 4px; outline: none; display: none; text-transform: uppercase; margin: 0;";
    
    const optAuto = document.createElement("option");
    optAuto.value = "AUTO"; optAuto.innerText = "AUTO"; optAuto.style.background = "#1a1a1f";
    const optGpu = document.createElement("option");
    optGpu.value = "GPU"; optGpu.innerText = "GPU"; optGpu.style.background = "#1a1a1f";
    const optCpu = document.createElement("option");
    optCpu.value = "CPU"; optCpu.innerText = "CPU"; optCpu.style.background = "#1a1a1f";
    
    samDeviceSelect.append(optAuto, optGpu, optCpu);
    
    samDeviceSelect.addEventListener("mousedown", (e) => e.stopPropagation());
    samDeviceSelect.addEventListener("pointerdown", (e) => e.stopPropagation());

    samLabelContainer.append(samLabel, samDeviceSelect);
    advancedBlock.appendChild(samLabelContainer);

    let liveBtn;
    let updateLiveStyle;

    const samSelect = createSidebarSelect([
        { value: "sam2.1_hiera_tiny-fp16.safetensors", text: "(fast) sam2.1_hiera_tiny-fp16 (74MB)" },
        { value: "sam2.1_hiera_large-fp16.safetensors", text: "(balance) sam2.1_hiera_large-fp16 (430MB)" },
        { value: "sam3-fp16.safetensors", text: "(slow) sam3-fp16 (1.6GB)" }
    ]);
    advancedBlock.appendChild(samSelect);

    // Initialize node properties
    node.properties = node.properties || {};
    
    // Load previously saved model selections and device
    samSelect.value = node.properties.lastSelectedSAMModel || "sam2.1_hiera_tiny-fp16.safetensors";
    samDeviceSelect.value = node.properties.lastSelectedSAMDevice || "AUTO";

    const updateDeviceSelectVisibility = () => {
        if (samSelect.value === "sam3-fp16.safetensors") {
            samDeviceSelect.style.display = "inline-block";
        } else {
            samDeviceSelect.style.display = "none";
        }
    };
    updateDeviceSelectVisibility();

    samSelect.onfocus = () => {
        if (isDownloadingSAM) {
            samSelect.blur();
            alert("Please wait for the Segment Anything model download to complete. Do not close the editor or reload the page.");
        }
    };

    samSelect.onchange = async () => {
        if (isDownloadingSAM) {
            alert("Please wait for the Segment Anything model download to complete. Do not close the editor or reload the page.");
            return;
        }
        updateDeviceSelectVisibility();
        const selectedModel = samSelect.value;
        node.properties.lastSelectedSAMModel = selectedModel;
        const defaultVal = selectedModel.startsWith("sam2.1") ? "0.35" : "0.50";
        samThreshSlider.value = defaultVal;
        samThreshValInput.value = defaultVal;

        // Auto-disable live mode when model changes
        if (liveBtn && liveBtn.isActive) {
            liveBtn.isActive = false;
            if (updateLiveStyle) updateLiveStyle();
            node.properties.samLiveMode = false;
        }

        clearSAMHover();
        requestDraw();
        
        fetch('/trix/unload_model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: "sam" })
        }).catch(e => console.error("Failed to unload old SAM model:", e));
    };

    samDeviceSelect.onchange = async () => {
        const selectedDevice = samDeviceSelect.value;
        node.properties.lastSelectedSAMDevice = selectedDevice;
        clearSAMHover();
        requestDraw();
        
        fetch('/trix/unload_model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: "sam" })
        }).catch(e => console.error("Failed to unload SAM on device change:", e));
    };

    // SAM Threshold Slider & Editable Input
    const samThreshContainer = document.createElement("div");
    samThreshContainer.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-shrink: 0;";
    samThreshContainer.title = "";
    
    const samThreshLbl = document.createElement("span");
    samThreshLbl.innerText = "Threshold: ";
    samThreshLbl.style.cssText = "color: #aaa; font-size: 11px; flex-shrink: 0; display: flex; align-items: center;";
    samThreshLbl.title = "";
    
    const samThreshValInput = document.createElement("input");
    samThreshValInput.type = "text";
    samThreshValInput.className = "trix-thresh-input";
    samThreshValInput.style.cssText = "background: transparent; border: none; color: #fff; font-weight: bold; font-size: 11px; width: 32px; outline: none; margin-left: 2px; padding: 0; cursor: text; text-align: left;";
    samThreshValInput.title = "";
    samThreshValInput.value = "0.35"; // Default SAM 2.1
    samThreshLbl.appendChild(samThreshValInput);

    const samThreshSlider = document.createElement("input");
    samThreshSlider.type = "range";
    samThreshSlider.min = "0.0";
    samThreshSlider.max = "1.0";
    samThreshSlider.step = "0.01";
    samThreshSlider.value = "0.35";
    samThreshSlider.className = "trix-slider";
    samThreshSlider.title = "";
    samThreshSlider.style.cssText = "flex: 1; margin-left: 10px; cursor: pointer;";

    samThreshSlider.oninput = (e) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val)) val = 0.35;
        val = Math.max(0.0, Math.min(1.0, val));
        samThreshValInput.value = val.toFixed(2);
    };

    samThreshValInput.oninput = (e) => {
        let valStr = e.target.value.replace(/[^0-9.]/g, '');
        const parts = valStr.split('.');
        if (parts.length > 2) {
            valStr = parts[0] + '.' + parts.slice(1).join('');
        }
        e.target.value = valStr;
        
        let val = parseFloat(valStr);
        if (!isNaN(val)) {
            val = Math.max(0.0, Math.min(1.0, val));
            samThreshSlider.value = val;
        }
    };

    samThreshValInput.onblur = (e) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val)) {
            val = parseFloat(samThreshSlider.value);
        }
        val = Math.max(0.0, Math.min(1.0, val));
        samThreshValInput.value = val.toFixed(2);
        samThreshSlider.value = val;
    };

    samThreshSlider.ondblclick = () => {
        const selectedModel = samSelect.value;
        const defaultVal = selectedModel.startsWith("sam2.1") ? "0.35" : "0.50";
        samThreshSlider.value = defaultVal;
        samThreshValInput.value = defaultVal;
    };

    samThreshContainer.append(samThreshLbl, samThreshSlider);
    advancedBlock.appendChild(samThreshContainer);

    const samRow = document.createElement("div");
    samRow.style.cssText = "display: flex; gap: 8px; width: 100%; align-items: center; margin-bottom: 16px; flex-shrink: 0;";

    const samBtn = createSidebarButton("Select Object", false, true);
    samBtn.style.flex = "1";
    samBtn.style.marginBottom = "0";
    samBtn.style.fontSize = "10.5px";
    samBtn.style.paddingLeft = "4px";
    samBtn.style.paddingRight = "4px";
    samBtn.style.whiteSpace = "nowrap";

    const proBtn = document.createElement("button");
    proBtn.innerText = "PRO";
    proBtn.style.cssText = `
        width: 50px; padding: 10px 0; border-radius: 6px; font-weight: bold;
        font-size: 12px; cursor: pointer; transition: all 0.2s;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        flex-shrink: 0; text-align: center;
        border: 1px solid #444; background: #2a2a2f; color: #ccc;
    `;
    proBtn.isActive = !!node.properties.samProMode;
    proBtn.title = "PRO mode: Focuses SAM on the active square area when zoomed, increasing accuracy for fine details and ignoring background features outside the box.";
    
    const updateProStyle = () => {
        if (proBtn.isActive) {
            proBtn.style.background = TRIX_ACCENT;
            proBtn.style.borderColor = TRIX_ACCENT;
            proBtn.style.color = "#fff";
        } else {
            proBtn.style.background = "#2a2a2f";
            proBtn.style.borderColor = "#444";
            proBtn.style.color = "#ccc";
        }
    };
    updateProStyle();

    proBtn.onclick = () => {
        proBtn.isActive = !proBtn.isActive;
        updateProStyle();
        node.properties.samProMode = proBtn.isActive;
    };
    proBtn.onmouseenter = () => {
        if (proBtn.isActive) {
            proBtn.style.background = TRIX_ACCENT_HOVER;
            proBtn.style.color = "#fff";
        } else {
            proBtn.style.background = "#333a45";
            proBtn.style.color = "#fff";
        }
    };
    proBtn.onmouseleave = () => {
        updateProStyle();
    };

    liveBtn = document.createElement("button");
    liveBtn.innerText = "LIVE";
    liveBtn.title = "Enable real-time hover preview for SAM";
    liveBtn.style.cssText = `
        width: 50px; padding: 10px 0; border-radius: 6px; font-weight: bold;
        font-size: 12px; cursor: pointer; transition: all 0.2s;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        flex-shrink: 0; text-align: center;
        border: 1px solid #444; background: #2a2a2f; color: #ccc;
    `;
    if (node.properties.samLiveMode === undefined) {
        node.properties.samLiveMode = false;
    }
    liveBtn.isActive = !!node.properties.samLiveMode;
    
    updateLiveStyle = () => {
        if (liveBtn.isActive) {
            liveBtn.style.background = TRIX_ACCENT;
            liveBtn.style.borderColor = TRIX_ACCENT;
            liveBtn.style.color = "#fff";
        } else {
            liveBtn.style.background = "#2a2a2f";
            liveBtn.style.borderColor = "#444";
            liveBtn.style.color = "#ccc";
        }
    };
    updateLiveStyle();

    const preloadSAMModel = async () => {
        if (isDownloadingSAM) return;
        const selectedModel = samSelect.value;
        const loaded = await checkAndDownloadModel("sam", selectedModel);
        if (!loaded) return;
        try {
            const nodeImgVal = getSAMImageParam();
            await fetch('/trix/load_model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: selectedModel,
                    image: nodeImgVal,
                    device: samDeviceSelect.value
                })
            });
            console.log("TrixLoader: SAM model preloaded successfully.");
        } catch (e) {
            console.error("TrixLoader: Failed to preload SAM model:", e);
        }
    };

    liveBtn.onclick = () => {
        liveBtn.isActive = !liveBtn.isActive;
        updateLiveStyle();
        node.properties.samLiveMode = liveBtn.isActive;
        if (liveBtn.isActive) {
            if (samBtn.isActive) {
                preloadSAMModel();
            }
        } else {
            // Immediately clear hover preview
            if (samHoverTimeout) {
                clearTimeout(samHoverTimeout);
                samHoverTimeout = null;
            }
            if (samHoverAbortCtrl) {
                samHoverAbortCtrl.abort();
                samHoverAbortCtrl = null;
            }
            samHoverCanvas = null;
            samHoverCoords = null;
            requestDraw();
        }
    };
    liveBtn.onmouseenter = () => {
        if (liveBtn.isActive) {
            liveBtn.style.background = TRIX_ACCENT_HOVER;
            liveBtn.style.color = "#fff";
        } else {
            liveBtn.style.background = "#333a45";
            liveBtn.style.color = "#fff";
        }
    };
    liveBtn.onmouseleave = () => {
        updateLiveStyle();
    };

    samRow.append(samBtn, proBtn, liveBtn);
    advancedBlock.appendChild(samRow);

    // SAM Text Prompt Container
    const samTextPromptContainer = document.createElement("div");
    samTextPromptContainer.style.cssText = "display: none; align-items: center; gap: 6px; margin-top: 8px; margin-bottom: 8px; flex-shrink: 0;";
    
    const samTextInput = document.createElement("input");
    samTextInput.type = "text";
    samTextInput.placeholder = "Enter text prompt (e.g. head)...";
    samTextInput.style.cssText = "flex: 1; background: #151515; border: 1px solid #333; border-radius: 4px; color: #fff; padding: 6px 10px; font-size: 11px; outline: none;";
    
    const samSubmitBtn = document.createElement("button");
    samSubmitBtn.style.cssText = `width: 28px; height: 28px; background: ${TRIX_ACCENT}; border: none; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: background 0.2s;`;
    samSubmitBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    
    samTextInput.onkeydown = (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            if (isDownloadingSAM) {
                alert("Please wait for the Segment Anything model download to complete. Do not close the editor or reload the page.");
                return;
            }
            samSubmitBtn.click();
        }
    };
    
    samSubmitBtn.onmouseenter = () => { samSubmitBtn.style.background = "#33789a"; };
    samSubmitBtn.onmouseleave = () => { samSubmitBtn.style.background = TRIX_ACCENT; };
    
    samSubmitBtn.onclick = async () => {
        if (isDownloadingSAM) {
            alert("Please wait for the Segment Anything model download to complete. Do not close the editor or reload the page.");
            return;
        }
        const textVal = samTextInput.value.trim();
        if (!textVal) return;
        
        const selectedModel = samSelect.value;

        const loaded = await checkAndDownloadModel("sam", selectedModel);
        if (!loaded) return;

        // GroundingDINO is required for SAM 2.1 text prompts
        if (selectedModel.startsWith("sam2.1")) {
            const dinoLoaded = await checkAndDownloadModel("sam", "groundingdino_swint_ogc.safetensors");
            if (!dinoLoaded) return;
        }

        lockUI();
        showStatus(`Segmenting "${textVal}"...`);
        try {
            const nodeImgVal = getSAMImageParam();
            const resp = await fetch('/trix/sam_predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: nodeImgVal,
                    model: selectedModel,
                    text_prompt: textVal,
                    threshold: parseFloat(samThreshSlider.value),
                    device: samDeviceSelect.value,
                    pro: proBtn.isActive,
                    image_width: imgW,
                    image_height: imgH,
                    pro_crop: proBtn.isActive ? getSAMProCropBox() : null
                })
            });
            const result = await resp.json();
            if (result.status === "success") {
                await new Promise((resolve) => {
                    const samMask = new Image();
                    samMask.onload = () => {
                        const alphaMask = convertGrayscaleToAlpha(samMask);
                        rawCtx.save();
                        rawCtx.globalCompositeOperation = "source-over";
                        rawCtx.drawImage(alphaMask, 0, 0);
                        rawCtx.restore();
                        resolve();
                    };
                    samMask.onerror = resolve;
                    samMask.src = "data:image/png;base64," + result.mask;
                });
                saveHistory();
                requestDraw();
            } else {
                alert("SAM failed: " + result.error);
            }
        } catch (e) {
            console.error(e);
            alert("Error in SAM text segment: " + e.message);
        } finally {
            unlockUI();
            hideStatus();
        }
    };

    samTextPromptContainer.append(samTextInput, samSubmitBtn);
    advancedBlock.appendChild(samTextPromptContainer);

    const updateSAMUI = () => {
        if (samBtn.isActive) {
            samTextPromptContainer.style.display = "flex";
        } else {
            samTextPromptContainer.style.display = "none";
        }
        if (samBtn.updateSidebarBtnStyle) samBtn.updateSidebarBtnStyle();
    };

    // Separator between SAM and Background Removal
    const samBgSeparator = document.createElement("div");
    samBgSeparator.style.cssText = "height: 1px; background: rgba(255,255,255,0.05); margin: 6px 0; flex-shrink: 0;";
    advancedBlock.appendChild(samBgSeparator);

    // Background Removal Dropdown
    advancedBlock.appendChild(createSidebarLabel("Mask Background", "Mask only the background using AI."));
    const bgSelect = createSidebarSelect([
        { value: "inspyrenet-bf16.safetensors", text: "inspyrenet-bf16 (174.19 MB)" },
        { value: "Ben2.safetensors", text: "Ben2 (362.95 MB)" },
        { value: "Birefnet-lite.safetensors", text: "Birefnet-lite (169.41 MB)" },
        { value: "Birefnet.safetensors", text: "Birefnet (423.88 MB)" },
        { value: "BiRefNet_HR.safetensors", text: "BiRefNet_HR (423.88 MB)" },
        { value: "BiRefNet-portrait.safetensors", text: "BiRefNet-portrait (843.89 MB)" },
        { value: "birefnet_finetuned_toonout.pth", text: "birefnet_finetuned_toonout (844.05 MB)" }
    ]);
    advancedBlock.appendChild(bgSelect);
    
    // Load previously saved background removal model selection
    bgSelect.value = node.properties.lastSelectedBGModel || "inspyrenet-bf16.safetensors";

    bgSelect.onfocus = () => {
        if (isDownloadingBG) {
            bgSelect.blur();
            alert("Please wait for the background removal model download to complete. Do not close the editor or reload the page.");
        }
    };

    bgSelect.onchange = () => {
        if (isDownloadingBG) {
            alert("Please wait for the background removal model download to complete. Do not close the editor or reload the page.");
            return;
        }
        node.properties.lastSelectedBGModel = bgSelect.value;
        fetch('/trix/unload_model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: "bg" })
        }).catch(e => console.error("Failed to unload old BG model:", e));
    };

    // Alpha Matting Checkbox
    const mattingRow = document.createElement("label");
    mattingRow.style.cssText = "display: flex; align-items: center; gap: 8px; color: #ccc; font-size: 11px; cursor: pointer; margin-bottom: 12px; flex-shrink: 0;";
    const mattingCheckbox = document.createElement("input");
    mattingCheckbox.type = "checkbox";
    mattingCheckbox.checked = false;
    mattingCheckbox.style.cssText = `accent-color: ${TRIX_ACCENT}; cursor: pointer; flex-shrink: 0;`;
    mattingRow.append(mattingCheckbox, document.createTextNode("Use Alpha Matting (Refined Edges)"));
    advancedBlock.appendChild(mattingRow);

    const bgBtn = createSidebarButton("Mask Background", true);
    advancedBlock.appendChild(bgBtn);

    sidebar.appendChild(advancedBlock);

    // ==========================================
    // SIDEBAR: GROW & BLUR (APPLY-ONCE)
    // ==========================================
    const growBlurLabel = createSidebarLabel("Grow / Blur / Fill / Smooth");
    sidebar.appendChild(growBlurLabel);

    // Toggle button
    const growBlurToggleBtn = document.createElement("button");
    growBlurToggleBtn.innerText = "Grow / Blur / Fill / Smooth";
    growBlurToggleBtn.style.cssText = `
        width: 100%; padding: 8px 14px; border-radius: 6px; font-weight: bold;
        font-size: 12px; cursor: pointer; transition: all 0.2s;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        margin-bottom: 8px; flex-shrink: 0;
        border: 1px solid #444;
        background: #2a2a2f; color: #ccc;
    `;
    growBlurToggleBtn.onmouseenter = () => {
        if (!growBlurPanelVisible) {
            growBlurToggleBtn.style.background = "#333a45";
            growBlurToggleBtn.style.color = "#fff";
        }
    };
    growBlurToggleBtn.onmouseleave = () => {
        if (!growBlurPanelVisible) {
            growBlurToggleBtn.style.background = "#2a2a2f";
            growBlurToggleBtn.style.color = "#ccc";
        }
    };

    // Panel container (hidden by default)
    const growBlurPanel = document.createElement("div");
    growBlurPanel.style.cssText = "display: none; flex-direction: column; margin-bottom: 10px; flex-shrink: 0;";
    let growBlurPanelVisible = false;

    growBlurToggleBtn.onclick = () => {
        growBlurPanelVisible = !growBlurPanelVisible;
        growBlurPanel.style.display = growBlurPanelVisible ? "flex" : "none";
        growBlurToggleBtn.style.background = growBlurPanelVisible ? TRIX_ACCENT : "#2a2a2f";
        growBlurToggleBtn.style.color = growBlurPanelVisible ? "#fff" : "#ccc";
        growBlurToggleBtn.style.borderColor = growBlurPanelVisible ? TRIX_ACCENT : "#444";
        node._maskFiltersDirty = true;
        requestDraw();
    };

    // Grow Slider
    // Grow Slider
    const growContainer = document.createElement("div");
    growContainer.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; flex-shrink: 0;";
    const growLbl = document.createElement("span");
    growLbl.style.cssText = "color: #aaa; font-size: 11px; width: 80px; flex-shrink: 0;";
    growLbl.innerText = "Grow: 0 px";
    const growSlider = document.createElement("input");
    growSlider.type = "range"; growSlider.min = "-100"; growSlider.max = "100"; growSlider.value = "0";
    growSlider.className = "trix-slider";
    growSlider.style.cssText = "flex: 1; margin-left: 10px; cursor: pointer;";
    growContainer.append(growLbl, growSlider);

    // Blur Slider
    const blurContainer = document.createElement("div");
    blurContainer.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; flex-shrink: 0;";
    const blurLbl = document.createElement("span");
    blurLbl.innerText = "Blur: 0 px";
    blurLbl.style.cssText = "color: #aaa; font-size: 11px; width: 80px; flex-shrink: 0;";
    const blurSlider = document.createElement("input");
    blurSlider.type = "range"; blurSlider.min = "0"; blurSlider.max = "100"; blurSlider.value = "0";
    blurSlider.className = "trix-slider";
    blurSlider.style.cssText = "flex: 1; margin-left: 10px; cursor: pointer;";
    blurContainer.append(blurLbl, blurSlider);

    // Fill Holes Slider
    const fillHolesContainer = document.createElement("div");
    fillHolesContainer.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; flex-shrink: 0;";
    const fillHolesLbl = document.createElement("span");
    fillHolesLbl.style.cssText = "color: #aaa; font-size: 11px; width: 80px; flex-shrink: 0;";
    fillHolesLbl.innerText = "Fill Holes: 0";
    const fillHolesSlider = document.createElement("input");
    fillHolesSlider.type = "range"; fillHolesSlider.min = "0"; fillHolesSlider.max = "100"; fillHolesSlider.value = "0";
    fillHolesSlider.className = "trix-slider";
    fillHolesSlider.style.cssText = "flex: 1; margin-left: 10px; cursor: pointer;";
    fillHolesContainer.append(fillHolesLbl, fillHolesSlider);

    // Smooth Edges Slider
    const smoothEdgesContainer = document.createElement("div");
    smoothEdgesContainer.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-shrink: 0;";
    const smoothEdgesLbl = document.createElement("span");
    smoothEdgesLbl.style.cssText = "color: #aaa; font-size: 11px; width: 80px; flex-shrink: 0;";
    smoothEdgesLbl.innerText = "Smooth: 0 px";
    const smoothEdgesSlider = document.createElement("input");
    smoothEdgesSlider.type = "range"; smoothEdgesSlider.min = "0"; smoothEdgesSlider.max = "100"; smoothEdgesSlider.value = "0";
    smoothEdgesSlider.className = "trix-slider";
    smoothEdgesSlider.style.cssText = "flex: 1; margin-left: 10px; cursor: pointer;";
    smoothEdgesContainer.append(smoothEdgesLbl, smoothEdgesSlider);

    // Apply button (hidden until sliders are changed) - colored orange
    const growBlurApplyBtn = document.createElement("button");
    growBlurApplyBtn.innerText = "Apply";
    growBlurApplyBtn.style.cssText = `
        width: 100%; padding: 8px; border-radius: 5px; border: none;
        background: #e05a10; color: #fff; font-weight: bold; font-size: 12px;
        cursor: pointer; display: none; transition: background 0.2s; flex-shrink: 0;
    `;
    growBlurApplyBtn.onmouseenter = () => { growBlurApplyBtn.style.background = "#f56d25"; };
    growBlurApplyBtn.onmouseleave = () => { growBlurApplyBtn.style.background = "#e05a10"; };

    let growBlurDirty = false;

    const updateGrowBlurApplyVisibility = () => {
        growBlurApplyBtn.style.display = growBlurDirty ? "block" : "none";
    };

    const checkGrowBlurDirty = () => {
        return (
            parseInt(growSlider.value, 10) !== 0 ||
            parseInt(blurSlider.value, 10) !== 0 ||
            parseInt(fillHolesSlider.value, 10) !== 0 ||
            parseInt(smoothEdgesSlider.value, 10) !== 0
        );
    };

    growSlider.oninput = (e) => {
        const val = parseInt(e.target.value, 10);
        growLbl.innerText = val < 0 ? `Shrink: ${Math.abs(val)} px` : `Grow: ${val} px`;
        growBlurDirty = checkGrowBlurDirty();
        updateGrowBlurApplyVisibility();
        node._maskFiltersDirty = true;
        requestDraw();
    };
    growSlider.ondblclick = () => {
        growSlider.value = "0";
        growLbl.innerText = "Grow: 0 px";
        growBlurDirty = checkGrowBlurDirty();
        updateGrowBlurApplyVisibility();
        node._maskFiltersDirty = true;
        requestDraw();
    };

    blurSlider.oninput = (e) => {
        blurLbl.innerText = `Blur: ${e.target.value} px`;
        growBlurDirty = checkGrowBlurDirty();
        updateGrowBlurApplyVisibility();
        node._maskFiltersDirty = true;
        requestDraw();
    };
    blurSlider.ondblclick = () => {
        blurSlider.value = "0";
        blurLbl.innerText = "Blur: 0 px";
        growBlurDirty = checkGrowBlurDirty();
        updateGrowBlurApplyVisibility();
        node._maskFiltersDirty = true;
        requestDraw();
    };

    fillHolesSlider.oninput = (e) => {
        fillHolesLbl.innerText = `Fill Holes: ${e.target.value}`;
        growBlurDirty = checkGrowBlurDirty();
        updateGrowBlurApplyVisibility();
        node._maskFiltersDirty = true;
        requestDraw();
    };
    fillHolesSlider.ondblclick = () => {
        fillHolesSlider.value = "0";
        fillHolesLbl.innerText = "Fill Holes: 0";
        growBlurDirty = checkGrowBlurDirty();
        updateGrowBlurApplyVisibility();
        node._maskFiltersDirty = true;
        requestDraw();
    };

    smoothEdgesSlider.oninput = (e) => {
        smoothEdgesLbl.innerText = `Smooth: ${e.target.value} px`;
        growBlurDirty = checkGrowBlurDirty();
        updateGrowBlurApplyVisibility();
        node._maskFiltersDirty = true;
        requestDraw();
    };
    smoothEdgesSlider.ondblclick = () => {
        smoothEdgesSlider.value = "0";
        smoothEdgesLbl.innerText = "Smooth: 0 px";
        growBlurDirty = checkGrowBlurDirty();
        updateGrowBlurApplyVisibility();
        node._maskFiltersDirty = true;
        requestDraw();
    };

    growBlurApplyBtn.onclick = () => {
        if (node._isUIBlocked) return;
        const growVal = parseInt(growSlider.value, 10);
        const blurVal = parseInt(blurSlider.value, 10);
        const fillHolesVal = parseInt(fillHolesSlider.value, 10);
        const smoothEdgesVal = parseInt(smoothEdgesSlider.value, 10);

        // Apply grow/blur/fill/smooth to a temp canvas
        const applyCanvas = document.createElement("canvas");
        applyCanvas.width = imgW;
        applyCanvas.height = imgH;
        const applyCtx = applyCanvas.getContext("2d");
        applyGrowBlur(applyCtx, growVal, blurVal, fillHolesVal, smoothEdgesVal);

        // Bake result into rawMaskCanvas
        rawCtx.clearRect(0, 0, imgW, imgH);
        rawCtx.drawImage(applyCanvas, 0, 0);

        // Reset sliders to 0
        growSlider.value = "0";
        blurSlider.value = "0";
        fillHolesSlider.value = "0";
        smoothEdgesSlider.value = "0";
        growLbl.innerText = "Grow: 0 px";
        blurLbl.innerText = "Blur: 0 px";
        fillHolesLbl.innerText = "Fill Holes: 0";
        smoothEdgesLbl.innerText = "Smooth: 0 px";
        growBlurDirty = false;
        updateGrowBlurApplyVisibility();

        node._maskFiltersDirty = true;
        saveHistory();
        requestDraw();
    };

    growBlurPanel.appendChild(growContainer);
    growBlurPanel.appendChild(blurContainer);
    growBlurPanel.appendChild(fillHolesContainer);
    growBlurPanel.appendChild(smoothEdgesContainer);
    growBlurApplyBtn.style.marginTop = "6px";
    growBlurPanel.appendChild(growBlurApplyBtn);

    sidebar.appendChild(growBlurToggleBtn);
    sidebar.appendChild(growBlurPanel);



    // ==========================================
    // SIDEBAR: OUTPAINT INTEGRATION
    // ==========================================
    sidebar.appendChild(createSidebarLabel("Image Outpaint"));
    const outpaintBtn = createSidebarButton("Pad Image for Outpaint", false);
    sidebar.appendChild(outpaintBtn);

    // Spacer
    const flexSpacer = document.createElement("div");
    flexSpacer.style.cssText = "flex-grow: 1; flex-shrink: 0; min-height: 20px;";
    sidebar.appendChild(flexSpacer);

    // Save subject cutout to disk (transparent PNG)
    const saveCutoutBtn = document.createElement("button");
    saveCutoutBtn.innerText = "Save to Disk";
    saveCutoutBtn.title = "Save the cutout image with transparent background";
    saveCutoutBtn.style.cssText = `
        flex: 1; width: auto; padding: 10px 14px; border: none; border-radius: 6px; font-weight: bold;
        font-size: 12px; cursor: pointer; transition: all 0.2s;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        background: rgb(42,42,42); color: #fff; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
    `;
    saveCutoutBtn.onmouseenter = () => {
        saveCutoutBtn.style.background = "rgb(55,55,55)";
    };
    saveCutoutBtn.onmouseleave = () => {
        saveCutoutBtn.style.background = "rgb(42,42,42)";
    };
    saveCutoutBtn.onclick = () => {
        if (node._isUIBlocked) return;
        
        // grow/blur already baked into rawMaskCanvas via Apply button — copy directly
        tempCtx.clearRect(0, 0, imgW, imgH);
        tempCtx.drawImage(rawMaskCanvas, 0, 0);
        
        const cutoutCvs = document.createElement("canvas");
        cutoutCvs.width = imgW;
        cutoutCvs.height = imgH;
        const cutoutCtx = cutoutCvs.getContext("2d");
        
        if (currentDecontImg && currentDecontImg.complete) {
            cutoutCtx.drawImage(currentDecontImg, 0, 0);
        } else {
            cutoutCtx.drawImage(origImgObj, 0, 0);
        }
        
        cutoutCtx.globalCompositeOperation = "destination-out";
        cutoutCtx.drawImage(tempCanvas, 0, 0);
        cutoutCtx.globalCompositeOperation = "source-over";
        
        
        cutoutCvs.toBlob(async (blob) => {
            if (!blob) {
                alert("Failed to generate cutout.");
                return;
            }
            const filename = `trix_cutout_${Date.now()}.png`;
            if (window.showSaveFilePicker) {
                try {
                    const handle = await window.showSaveFilePicker({
                        suggestedName: filename,
                        types: [{
                            description: 'PNG Image (*.png)',
                            accept: {'image/png': ['.png']}
                        }]
                    });
                    const writable = await handle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                    return;
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    console.error("Save file picker failed:", err);
                }
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.style.display = "none";
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 60000);
        }, "image/png");
    };

    // Single Save button
    const backBtn = document.createElement("button");
    backBtn.innerText = "Save";
    backBtn.style.cssText = `
        flex: 1; width: auto; padding: 10px 14px; border: none; border-radius: 6px; font-weight: bold;
        font-size: 12px; cursor: pointer; transition: all 0.2s;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        background: ${TRIX_ACCENT}; color: #fff; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
    `;
    backBtn.onmouseenter = () => {
        backBtn.style.background = TRIX_ACCENT_HOVER;
    };
    backBtn.onmouseleave = () => {
        backBtn.style.background = TRIX_ACCENT;
    };
    backBtn.onclick = () => saveMask();

    const saveRow = document.createElement("div");
    saveRow.style.cssText = "display: flex; gap: 8px; width: 100%; margin-top: 10px; flex-shrink: 0;";
    saveRow.append(saveCutoutBtn, backBtn);
    sidebar.appendChild(saveRow);

    // ==========================================
    // MAIN AREA (RIGHT SIDE)
    // ==========================================
    const mainArea = document.createElement("div");
    mainArea.style.cssText = "flex: 1; height: 100%; display: flex; flex-direction: column; position: relative;";

    // Top Toolbar with glassmorphism
    const toolbar = document.createElement("div");
    toolbar.style.cssText = `
        min-height: 50px; height: auto; width: 100%;
        background: #151515;
        border-bottom: 1px solid #333;
        display: flex; flex-wrap: wrap; align-items: center; padding: 6px 20px; box-sizing: border-box;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 5; gap: 10px 15px;
    `;

    // Canvas view area with premium dark checkerboard pattern
    const canvasContainer = document.createElement("div");
    canvasContainer.style.cssText = `
        flex: 1; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center;
        background-color: #14151a;
        background-image: linear-gradient(45deg, #1d1e24 25%, transparent 25%, transparent 75%, #1d1e24 75%, #1d1e24),
                          linear-gradient(45deg, #1d1e24 25%, transparent 25%, transparent 75%, #1d1e24 75%, #1d1e24);
        background-size: 16px 16px; background-position: 0 0, 8px 8px;
    `;

    const editorCanvas = document.createElement("canvas");
    editorCanvas.style.cssText = "position: absolute; left: 0; top: 0; width: 100%; height: 100%; cursor: crosshair;";
    canvasContainer.appendChild(editorCanvas);
    mainArea.append(toolbar, canvasContainer);

    overlay.append(sidebar, mainArea);
    document.body.appendChild(overlay);

    // ==========================================
    // IMAGE AND DOUBLE CANVASES SETUP
    // ==========================================
    const origImgObj = new Image();
    origImgObj.crossOrigin = "Anonymous";
    origImgObj.onload = () => {
        resizeCanvas();
        requestDraw();
    };
    origImgObj.src = node.imgTagRef.src;

    let imgW = node.imgTagRef.naturalWidth;
    let imgH = node.imgTagRef.naturalHeight;

    const getSAMProCropBox = () => {
        const viewCx = (editorCanvas.width / 2 - camera.x) / camera.zoom;
        const viewCy = (editorCanvas.height / 2 - camera.y) / camera.zoom;
        const viewW = editorCanvas.width / camera.zoom;
        const viewH = editorCanvas.height / camera.zoom;
        let side = Math.min(viewW, viewH) * 0.9;
        side = Math.min(side, imgW, imgH);
        if (side < 10) side = 10;
        let cropX = viewCx - side / 2;
        let cropY = viewCy - side / 2;
        if (cropX < 0) cropX = 0;
        if (cropY < 0) cropY = 0;
        if (cropX + side > imgW) cropX = imgW - side;
        if (cropY + side > imgH) cropY = imgH - side;
        return {
            x: cropX,
            y: cropY,
            width: side,
            height: side
        };
    };

    // rawMaskCanvas holds the user's base drawn pixels (without grow/blur)
    const rawMaskCanvas = document.createElement("canvas");
    rawMaskCanvas.width = imgW;
    rawMaskCanvas.height = imgH;
    const rawCtx = rawMaskCanvas.getContext("2d");

    // Temp Canvas used for Grow & Blur calculations
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = imgW;
    tempCanvas.height = imgH;
    const tempCtx = tempCanvas.getContext("2d");

    // Reusable canvas for dilation (grow)
    const dilateCanvas = document.createElement("canvas");
    dilateCanvas.width = imgW;
    dilateCanvas.height = imgH;
    const dilateCtx = dilateCanvas.getContext("2d");

    // Reusable canvas for coloring mask preview
    const maskColorCanvas = document.createElement("canvas");
    maskColorCanvas.width = imgW;
    maskColorCanvas.height = imgH;
    const maskColorCtx = maskColorCanvas.getContext("2d");

    // Helper to convert single-channel grayscale model output into an alpha mask
    const convertGrayscaleToAlpha = (imgElement) => {
        const tempCvs = document.createElement("canvas");
        tempCvs.width = imgElement.naturalWidth || imgElement.width;
        tempCvs.height = imgElement.naturalHeight || imgElement.height;
        const tempCtx = tempCvs.getContext("2d");
        tempCtx.drawImage(imgElement, 0, 0);
        
        const imgData = tempCtx.getImageData(0, 0, tempCvs.width, tempCvs.height);
        const data = imgData.data;
        const hex = maskColor.replace(/^#/, "");
        const bigint = parseInt(hex, 16);
        const r = (bigint >> 16) & 255;
        const g = (bigint >> 8) & 255;
        const b = bigint & 255;

        for (let i = 0; i < data.length; i += 4) {
            const gray = data[i]; // R = G = B = gray for grayscale
            data[i + 3] = gray;   // Set alpha to the gray value
            data[i] = r;          // Color mask using selected color
            data[i + 1] = g;
            data[i + 2] = b;
        }
        tempCtx.putImageData(imgData, 0, 0);
        return tempCvs;
    };

    // Populate initial mask onto rawMaskCanvas directly from node.maskCanvasRef synchronously (Synergy!)
    if (node.maskCanvasRef && node.maskCanvasRef.width === imgW && node.maskCanvasRef.height === imgH) {
        rawCtx.drawImage(node.maskCanvasRef, 0, 0, imgW, imgH);
        saveHistory();
    } else if (originalMaskSrc) {
        const initMaskImg = new Image();
        initMaskImg.onload = () => {
            // Рисуем маску как есть — rawMaskCanvas хранит только бинарные данные
            rawCtx.drawImage(initMaskImg, 0, 0, imgW, imgH);
            saveHistory();
            requestDraw();
        };
        initMaskImg.src = originalMaskSrc;
    } else {
        saveHistory();
    }


    // ==========================================
    // DRAWING CONFIG
    // ==========================================

    // ==========================================
    // RE-RENDERING MASK WITH REAL-TIME FILTERS
    // ==========================================
    const getGrowBlurValues = () => {
        return {
            grow: parseInt(growSlider.value, 10),
            blur: parseInt(blurSlider.value, 10)
        };
    };

    const checkMaskBorders = (canvas) => {
        const w = canvas.width;
        const h = canvas.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const imgData = ctx.getImageData(0, 0, w, h);
        const pixels = imgData.data;
        
        let left = false, right = false, top = false, bottom = false;
        
        for (let x = 0; x < w; x++) {
            if (pixels[x * 4 + 3] > 10) {
                top = true;
            }
            if (pixels[((h - 1) * w + x) * 4 + 3] > 10) {
                bottom = true;
            }
        }
        
        for (let y = 0; y < h; y++) {
            if (pixels[(y * w) * 4 + 3] > 10) {
                left = true;
            }
            if (pixels[(y * w + w - 1) * 4 + 3] > 10) {
                right = true;
            }
        }
        
        return { left, right, top, bottom };
    };

    const drawDilation = (destCtx, srcCanvas, radius) => {
        if (radius <= 0) {
            destCtx.drawImage(srcCanvas, 0, 0);
            return;
        }
        for (let angle = 0; angle < 360; angle += 45) {
            const rad = angle * Math.PI / 180;
            const dx = Math.cos(rad) * radius;
            const dy = Math.sin(rad) * radius;
            destCtx.drawImage(srcCanvas, dx, dy);
        }
    };

    const drawErosion = (destCtx, srcCanvas, radius) => {
        if (radius <= 0) {
            destCtx.drawImage(srcCanvas, 0, 0);
            return;
        }
        
        const invCvs = document.createElement("canvas");
        invCvs.width = srcCanvas.width; invCvs.height = srcCanvas.height;
        const invCtx = invCvs.getContext("2d");
        
        invCtx.fillStyle = "#000000";
        invCtx.fillRect(0, 0, srcCanvas.width, srcCanvas.height);
        
        invCtx.globalCompositeOperation = "destination-out";
        invCtx.drawImage(srcCanvas, 0, 0);
        
        const dilateInvCvs = document.createElement("canvas");
        dilateInvCvs.width = srcCanvas.width; dilateInvCvs.height = srcCanvas.height;
        const dilateInvCtx = dilateInvCvs.getContext("2d");
        
        for (let angle = 0; angle < 360; angle += 45) {
            const rad = angle * Math.PI / 180;
            const dx = Math.cos(rad) * radius;
            const dy = Math.sin(rad) * radius;
            dilateInvCtx.drawImage(invCvs, dx, dy);
        }
        
        destCtx.clearRect(0, 0, srcCanvas.width, srcCanvas.height);
        destCtx.drawImage(srcCanvas, 0, 0);
        destCtx.globalCompositeOperation = "destination-out";
        destCtx.drawImage(dilateInvCvs, 0, 0);
        destCtx.globalCompositeOperation = "source-over";
    };

    const applyFillHoles = (ctx, fillVal, w, h) => {
        if (fillVal <= 0) return;
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;
        const len = w * h;
        const visited = new Uint8Array(len);
        const queue = new Int32Array(len);
        let qLen = 0;

        const visit = (x, y) => {
            const idx = y * w + x;
            if (visited[idx] === 0) {
                visited[idx] = 1;
                if (data[idx * 4 + 3] < 128) {
                    queue[qLen++] = idx;
                }
            }
        };

        for (let x = 0; x < w; x++) {
            visit(x, 0);
            visit(x, h - 1);
        }
        for (let y = 1; y < h - 1; y++) {
            visit(0, y);
            visit(w - 1, y);
        }

        let head = 0;
        while (head < qLen) {
            const curr = queue[head++];
            const cx = curr % w;
            const cy = Math.floor(curr / w);

            if (cx > 0) {
                const next = curr - 1;
                if (visited[next] === 0) {
                    visited[next] = 1;
                    if (data[next * 4 + 3] < 128) queue[qLen++] = next;
                }
            }
            if (cx < w - 1) {
                const next = curr + 1;
                if (visited[next] === 0) {
                    visited[next] = 1;
                    if (data[next * 4 + 3] < 128) queue[qLen++] = next;
                }
            }
            if (cy > 0) {
                const next = curr - w;
                if (visited[next] === 0) {
                    visited[next] = 1;
                    if (data[next * 4 + 3] < 128) queue[qLen++] = next;
                }
            }
            if (cy < h - 1) {
                const next = curr + w;
                if (visited[next] === 0) {
                    visited[next] = 1;
                    if (data[next * 4 + 3] < 128) queue[qLen++] = next;
                }
            }
        }

        const maxHoleSize = Math.pow(fillVal, 2.5);
        const holeQueue = new Int32Array(len);
        const hex = maskColor.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        for (let i = 0; i < len; i++) {
            if (data[i * 4 + 3] < 128 && visited[i] === 0) {
                let hLen = 0;
                holeQueue[hLen++] = i;
                visited[i] = 1;
                let hHead = 0;

                while (hHead < hLen) {
                    const curr = holeQueue[hHead++];
                    const cx = curr % w;
                    const cy = Math.floor(curr / w);

                    if (cx > 0) {
                        const next = curr - 1;
                        if (visited[next] === 0 && data[next * 4 + 3] < 128) {
                            visited[next] = 1;
                            holeQueue[hLen++] = next;
                        }
                    }
                    if (cx < w - 1) {
                        const next = curr + 1;
                        if (visited[next] === 0 && data[next * 4 + 3] < 128) {
                            visited[next] = 1;
                            holeQueue[hLen++] = next;
                        }
                    }
                    if (cy > 0) {
                        const next = curr - w;
                        if (visited[next] === 0 && data[next * 4 + 3] < 128) {
                            visited[next] = 1;
                            holeQueue[hLen++] = next;
                        }
                    }
                    if (cy < h - 1) {
                        const next = curr + w;
                        if (visited[next] === 0 && data[next * 4 + 3] < 128) {
                            visited[next] = 1;
                            holeQueue[hLen++] = next;
                        }
                    }
                }

                if (hLen <= maxHoleSize) {
                    for (let j = 0; j < hLen; j++) {
                        const idx = holeQueue[j];
                        data[idx * 4] = r;
                        data[idx * 4 + 1] = g;
                        data[idx * 4 + 2] = b;
                        data[idx * 4 + 3] = 255;
                    }
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);
    };

    const applySmoothEdges = (ctx, smoothVal, w, h) => {
        if (smoothVal <= 0) return;

        const blurCanvas = document.createElement("canvas");
        blurCanvas.width = w;
        blurCanvas.height = h;
        const blurCtx = blurCanvas.getContext("2d");

        blurCtx.filter = `blur(${smoothVal}px)`;
        blurCtx.drawImage(ctx.canvas, 0, 0);
        blurCtx.filter = "none";

        const imgData = blurCtx.getImageData(0, 0, w, h);
        const data = imgData.data;
        const len = w * h;

        const hex = maskColor.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        const gain = 8.0;

        for (let i = 0; i < len; i++) {
            const a = data[i * 4 + 3];
            if (a > 0) {
                let newA = (a - 128) * gain + 128;
                newA = Math.max(0, Math.min(255, newA));
                data[i * 4] = r;
                data[i * 4 + 1] = g;
                data[i * 4 + 2] = b;
                data[i * 4 + 3] = newA;
            }
        }
        ctx.clearRect(0, 0, w, h);
        ctx.putImageData(imgData, 0, 0);
    };

    const applyGrowBlur = (destCtx, growVal, blurVal, fillHolesVal = 0, smoothEdgesVal = 0) => {
        if (growVal === 0 && blurVal <= 0 && fillHolesVal <= 0 && smoothEdgesVal <= 0) {
            destCtx.clearRect(0, 0, imgW, imgH);
            destCtx.drawImage(rawMaskCanvas, 0, 0);
            return;
        }

        const borders = checkMaskBorders(rawMaskCanvas);
        const hasBorderTouch = borders.left || borders.right || borders.top || borders.bottom;

        let P = 0;
        let workW = imgW;
        let workH = imgH;
        let workCanvas, workCtx;

        if (hasBorderTouch) {
            P = Math.max(1, Math.ceil(blurVal + Math.abs(growVal)));
            workW = imgW + 2 * P;
            workH = imgH + 2 * P;

            workCanvas = document.createElement("canvas");
            workCanvas.width = workW;
            workCanvas.height = workH;
            workCtx = workCanvas.getContext("2d");

            // Copy mask and stretch boundaries to margins
            const paddedCanvas = document.createElement("canvas");
            paddedCanvas.width = workW;
            paddedCanvas.height = workH;
            const paddedCtx = paddedCanvas.getContext("2d");
            
            paddedCtx.drawImage(rawMaskCanvas, P, P);
            
            if (borders.left) {
                paddedCtx.drawImage(rawMaskCanvas, 0, 0, 1, imgH, 0, P, P, imgH);
            }
            if (borders.right) {
                paddedCtx.drawImage(rawMaskCanvas, imgW - 1, 0, 1, imgH, imgW + P, P, P, imgH);
            }
            if (borders.top) {
                paddedCtx.drawImage(rawMaskCanvas, 0, 0, imgW, 1, P, 0, imgW, P);
            }
            if (borders.bottom) {
                paddedCtx.drawImage(rawMaskCanvas, 0, imgH - 1, imgW, 1, P, imgH + P, imgW, P);
            }
            
            if (borders.top && borders.left) {
                paddedCtx.drawImage(rawMaskCanvas, 0, 0, 1, 1, 0, 0, P, P);
            }
            if (borders.top && borders.right) {
                paddedCtx.drawImage(rawMaskCanvas, imgW - 1, 0, 1, 1, imgW + P, 0, P, P);
            }
            if (borders.bottom && borders.left) {
                paddedCtx.drawImage(rawMaskCanvas, 0, imgH - 1, 1, 1, 0, imgH + P, P, P);
            }
            if (borders.bottom && borders.right) {
                paddedCtx.drawImage(rawMaskCanvas, imgW - 1, imgH - 1, 1, 1, imgW + P, imgH + P, P, P);
            }

            // Apply Dilation/Erosion onto workCtx
            if (growVal > 0) {
                drawDilation(workCtx, paddedCanvas, growVal);
            } else if (growVal < 0) {
                drawErosion(workCtx, paddedCanvas, -growVal);
            } else {
                workCtx.drawImage(paddedCanvas, 0, 0);
            }
        } else {
            workCanvas = document.createElement("canvas");
            workCanvas.width = workW;
            workCanvas.height = workH;
            workCtx = workCanvas.getContext("2d");

            if (growVal > 0) {
                drawDilation(workCtx, rawMaskCanvas, growVal);
            } else if (growVal < 0) {
                drawErosion(workCtx, rawMaskCanvas, -growVal);
            } else {
                workCtx.drawImage(rawMaskCanvas, 0, 0);
            }
        }

        if (fillHolesVal > 0) {
            applyFillHoles(workCtx, fillHolesVal, workW, workH);
        }

        if (smoothEdgesVal > 0) {
            applySmoothEdges(workCtx, smoothEdgesVal, workW, workH);
        }

        destCtx.clearRect(0, 0, imgW, imgH);
        if (blurVal > 0) {
            destCtx.filter = `blur(${blurVal}px)`;
        } else {
            destCtx.filter = "none";
        }
        destCtx.drawImage(workCanvas, -P, -P);
        destCtx.filter = "none";
    };

    // ==========================================
    // TOOLBAR BUTTON CREATORS
    // ==========================================
    const toolbarButtons = [];
    const createToolbarBtn = (iconSvg, text, tooltip, onClick, toggleable = false) => {
        const btn = document.createElement("button");
        btn.innerHTML = `${iconSvg} <span style="font-size: 11px; margin-left: 4px; font-weight: bold;">${text}</span>`;
        btn.title = tooltip;
        btn.style.cssText = "background: #2a2a2f; color: #ccc; border: 1px solid #444; border-radius: 4px; padding: 5px 10px; cursor: pointer; display: flex; align-items: center; transition: 0.1s; white-space: nowrap; flex-shrink: 0;";
        
        const updateStyle = () => {
            if (toggleable && btn.isActive) {
                btn.style.background = TRIX_ACCENT;
                btn.style.color = "#fff";
                btn.style.borderColor = TRIX_ACCENT;
            } else {
                btn.style.background = "#2a2a2f";
                btn.style.color = "#ccc";
                btn.style.borderColor = "#444";
            }
        };
        
        btn.onmouseenter = () => {
            if (!btn.isActive) btn.style.background = "#333a45";
        };
        btn.onmouseleave = () => {
            updateStyle();
        };
        btn.onclick = () => {
            onClick(btn);
            updateStyle();
        };
        btn.updateStyle = updateStyle;
        toolbar.appendChild(btn);
        toolbarButtons.push(btn);
        return btn;
    };

    // Brush Tool Sliders inside Toolbar
    const sizeContainer = document.createElement("div");
    sizeContainer.style.cssText = "display: flex; align-items: center; gap: 6px;";
    const sizeLabel = document.createElement("span");
    sizeLabel.innerText = `Size: ${brushSize}`;
    sizeLabel.style.cssText = "color: #aaa; font-size: 11px; width: 50px;";
    const sizeInput = document.createElement("input");
    sizeInput.type = "range"; sizeInput.min = "1"; sizeInput.max = "250"; sizeInput.value = brushSize;
    sizeInput.className = "trix-slider";
    sizeInput.style.cssText = "width: 80px; cursor: pointer;";
    sizeInput.oninput = (e) => {
        brushSize = parseInt(e.target.value, 10);
        sizeLabel.innerText = `Size: ${brushSize}`;
    };
    sizeInput.ondblclick = () => {
        sizeInput.value = "50";
        brushSize = 50;
        sizeLabel.innerText = "Size: 50";
        requestDraw();
    };
    sizeContainer.append(sizeLabel, sizeInput);
    toolbar.appendChild(sizeContainer);

    const hardnessContainer = document.createElement("div");
    hardnessContainer.style.cssText = "display: flex; align-items: center; gap: 6px;";
    const hardnessLabel = document.createElement("span");
    hardnessLabel.innerText = `Hardness: ${Math.round(brushHardness * 100)}%`;
    hardnessLabel.style.cssText = "color: #aaa; font-size: 11px; width: 85px;";
    const hardnessInput = document.createElement("input");
    hardnessInput.type = "range"; hardnessInput.min = "0"; hardnessInput.max = "100"; hardnessInput.value = Math.round(brushHardness * 100);
    hardnessInput.className = "trix-slider";
    hardnessInput.style.cssText = "width: 80px; cursor: pointer;";
    hardnessInput.oninput = (e) => {
        brushHardness = parseInt(e.target.value, 10) / 100;
        hardnessLabel.innerText = `Hardness: ${Math.round(brushHardness*100)}%`;
    };
    hardnessInput.ondblclick = () => {
        hardnessInput.value = "100";
        brushHardness = 1.0;
        hardnessLabel.innerText = "Hardness: 100%";
        requestDraw();
    };
    hardnessContainer.append(hardnessLabel, hardnessInput);
    toolbar.appendChild(hardnessContainer);

    // Color Swapper in Toolbar
    const colorPick = document.createElement("div");
    colorPick.style.cssText = `width: 20px; height: 20px; border: 2px solid #555; border-radius: 50%; background-color: ${maskColor}; cursor: pointer; box-sizing: border-box; margin-right: 10px;`;
    colorPick.title = "Switch Mask color (Right-Click for visual opacity)";

    node._visualOpacityEditor = node._visualOpacityStandard !== undefined ? node._visualOpacityStandard : 0.65;

    colorPick.onclick = () => {
        colorIndex = (colorIndex + 1) % colorsList.length;
        maskColor = colorsList[colorIndex];
        node.maskColor = maskColor;
        colorPick.style.backgroundColor = maskColor;
    };

    colorPick.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const existing = document.getElementById("trix-visual-opacity-popup-editor");
        if (existing) {
            existing.remove();
        }

        const popup = document.createElement("div");
        popup.id = "trix-visual-opacity-popup-editor";
        popup.style.cssText = `
            position: fixed; z-index: 30000;
            background: #1c1c1f; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 6px;
            padding: 8px 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.6);
            display: flex; flex-direction: column; gap: 6px; width: 155px;
            font-family: sans-serif; pointer-events: auto;
        `;

        const rect = colorPick.getBoundingClientRect();
        popup.style.left = `${rect.left}px`;
        popup.style.top = `${rect.bottom + 5}px`;

        const label = document.createElement("span");
        label.style.cssText = "color: #ccc; font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; user-select: none;";
        label.innerText = `Mask Alpha: ${Math.round(node._visualOpacityEditor * 100)}%`;

        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = "100";
        slider.value = Math.round(node._visualOpacityEditor * 100);
        slider.className = "trix-slider";
        slider.style.cssText = "width: 100%; cursor: pointer;";

        slider.oninput = (ev) => {
            const val = parseFloat(ev.target.value) / 100;
            node._visualOpacityEditor = val;
            label.innerText = `Mask Alpha: ${ev.target.value}%`;
            requestDraw();
        };
        slider.ondblclick = () => {
            slider.value = 65;
            node._visualOpacityEditor = 0.65;
            label.innerText = `Mask Alpha: 65%`;
            requestDraw();
        };

        popup.append(label, slider);
        document.body.appendChild(popup);

        const closePopup = (ev) => {
            if (!popup.contains(ev.target) && ev.target !== colorPick) {
                popup.remove();
                document.removeEventListener("pointerdown", closePopup, { capture: true });
            }
        };
        setTimeout(() => {
            document.addEventListener("pointerdown", closePopup, { capture: true });
        }, 50);
    };
    toolbar.appendChild(colorPick);

    // Drawing Tool Toggles
    const drawBtn = createToolbarBtn(
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`,
        "Brush",
        "Standard drawing brush",
        (btn) => {
            isEraser = false;
            samBtn.isActive = false;
            updateSAMUI();
            btn.isActive = true;
            eraserBtn.isActive = false;
            if (eraserBtn.updateStyle) eraserBtn.updateStyle();
            clearSAMHover();
            requestDraw();
        },
        true
    );
    drawBtn.isActive = true;
    drawBtn.style.background = TRIX_ACCENT;
    drawBtn.style.color = "#fff";

    const eraserBtn = createToolbarBtn(
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H7L3 16C2.5 15.5 2.5 14.5 3 14L13 4C13.5 3.5 14.5 3.5 15 4L20 9C20.5 9.5 20.5 10.5 20 11L11 20H20V20Z"></path><line x1="17" y1="14" x2="10" y2="7"></line></svg>`,
        "Eraser",
        "Erase mask strokes",
        (btn) => {
            isEraser = true;
            samBtn.isActive = false;
            updateSAMUI();
            btn.isActive = true;
            drawBtn.isActive = false;
            if (drawBtn.updateStyle) drawBtn.updateStyle();
            clearSAMHover();
            requestDraw();
        },
        true
    );

    // Eye toggle to show/hide mask overlay
    const eyeBtn = createToolbarBtn(
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
        "Show Mask",
        "Toggle mask visibility on canvas",
        (btn) => {
            showMask = !showMask;
            btn.isActive = showMask;
            requestDraw();
        },
        true
    );
    eyeBtn.isActive = true;
    eyeBtn.style.background = TRIX_ACCENT;
    eyeBtn.style.color = "#fff";

    // Undo/Redo & Clear Action Buttons
    const undoBtn = createToolbarBtn(
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>`,
        "Undo",
        "Undo last action",
        () => applyHistory(historyIndex - 1)
    );
    const redoBtn = createToolbarBtn(
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 14 20 9 15 4"></polyline><path d="M4 20v-7a4 4 0 0 1 4-4h12"></path></svg>`,
        "Redo",
        "Redo next action",
        () => applyHistory(historyIndex + 1)
    );
    createToolbarBtn(
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`,
        "Clear",
        "Clear entire mask",
        () => {
            rawCtx.clearRect(0, 0, imgW, imgH);
            saveHistory();
            requestDraw();
        }
    );

    // Recenter Image Button
    const svgRecenter = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: text-bottom; margin-right: 4px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4" y1="12" x2="20" y2="12"></line></svg>`;
    recenterBtn = createToolbarBtn(
        svgRecenter,
        "Recenter",
        "Recenter image view",
        () => resizeCanvas(true)
    );
    updateRecenterBtnText = () => {
        if (!recenterBtn) return;
        const pct = Math.round((camera.zoom / baseFitScale) * 100);
        const span = recenterBtn.querySelector("span");
        if (span) {
            span.innerText = `Recenter (${pct}%)`;
        } else {
            recenterBtn.innerText = `Recenter (${pct}%)`;
        }
    };

    // Invert Mask Button
    const svgInvert = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: text-bottom; margin-right: 4px;"><path d="M12 2a10 10 0 0 0 0 20v-20z" /><path d="M12 2a10 10 0 0 1 0 20V2z" fill="none" /></svg>`;
    createToolbarBtn(
        svgInvert,
        "Invert Mask",
        "Invert the current mask selection",
        () => {
            if (node._isUIBlocked) return;
            const imgData = rawCtx.getImageData(0, 0, imgW, imgH);
            const data = imgData.data;
            const len = imgW * imgH;
            
            const hex = maskColor.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            
            for (let i = 0; i < len; i++) {
                const oldA = data[i * 4 + 3];
                data[i * 4] = r;
                data[i * 4 + 1] = g;
                data[i * 4 + 2] = b;
                data[i * 4 + 3] = 255 - oldA;
            }
            
            rawCtx.clearRect(0, 0, imgW, imgH);
            rawCtx.putImageData(imgData, 0, 0);
            
            node._maskFiltersDirty = true;
            saveHistory();
            requestDraw();
        }
    );

    // Refine Edge Button
    createToolbarBtn(
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path><circle cx="12" cy="12" r="4"></circle></svg>`,
        "Refine Edge",
        "Refine mask boundaries (Smart Radius)",
        async () => {
            if (node._isUIBlocked) return;
            lockUI();
            showStatus("Refining edge...");
            try {
                const nodeImgVal = getSAMImageParam();
                const maskB64 = rawMaskCanvas.toDataURL("image/png");
                const resp = await fetch('/trix/refine_mask', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        image: nodeImgVal,
                        mask: maskB64,
                        method: "refine_edge",
                        node_id: node.id
                    })
                });
                const result = await resp.json();
                if (result.status === "success") {
                    const refinedImg = new Image();
                    refinedImg.onload = () => {
                        rawCtx.clearRect(0, 0, imgW, imgH);
                        rawCtx.drawImage(refinedImg, 0, 0);
                        node._maskFiltersDirty = true;
                        
                        saveHistory();
                        requestDraw();
                        hideStatus();
                        unlockUI();
                    };
                    refinedImg.src = "data:image/png;base64," + result.mask;
                } else {
                    hideStatus();
                    unlockUI();
                    alert("Refine Edge failed: " + result.error);
                }
            } catch (e) {
                console.error(e);
                hideStatus();
                unlockUI();
                alert("Refine Edge failed: " + e.message);
            }
        }
    );

    // Refine Hair Button


    // Right side toolbar actions spacer
    const tbSpacer = document.createElement("div");
    tbSpacer.style.flexGrow = "1";
    toolbar.appendChild(tbSpacer);

    // ==========================================
    // HISTORY SYSTEM
    // ==========================================

    function saveHistory() {
        node._maskFiltersDirty = true;
        
        // Save state in memory for fast undo/redo
        const offscreen = document.createElement("canvas");
        offscreen.width = imgW;
        offscreen.height = imgH;
        offscreen.getContext("2d").drawImage(rawMaskCanvas, 0, 0);
        
        if (historyIndex < history.length - 1) {
            history = history.slice(0, historyIndex + 1);
        }
        history.push({
            maskCanvas: offscreen,
            decontImage: currentDecontImgB64
        });
        if (history.length > 15) {
            history.shift();
        }
        historyIndex = history.length - 1;

        // Synchronize main node canvas mask in real-time
        if (node.maskCanvasRef) {
            node.maskCanvasRef.width = imgW;
            node.maskCanvasRef.height = imgH;
            if (node.alignCanvasRef) node.alignCanvasRef();
            const mctx = node.maskCanvasRef.getContext("2d");
            mctx.clearRect(0, 0, imgW, imgH);
            mctx.drawImage(rawMaskCanvas, 0, 0);
            if (app.graph) app.graph.setDirtyCanvas(true, true);
        }
    }

    function applyHistory(idx) {
        if (idx < 0 || idx >= history.length) return;
        historyIndex = idx;
        const state = history[historyIndex];
        
        rawCtx.clearRect(0, 0, imgW, imgH);
        if (state.maskCanvas) {
            rawCtx.drawImage(state.maskCanvas, 0, 0);
            node._maskFiltersDirty = true;
            requestDraw();
        } else {
            // fallback if it's a string/object from initial state load
            const stateImg = new Image();
            stateImg.onload = () => {
                rawCtx.clearRect(0, 0, imgW, imgH);
                rawCtx.drawImage(stateImg, 0, 0);
                
                const offscreen = document.createElement("canvas");
                offscreen.width = imgW;
                offscreen.height = imgH;
                offscreen.getContext("2d").drawImage(stateImg, 0, 0);
                state.maskCanvas = offscreen;
                
                node._maskFiltersDirty = true;
                requestDraw();
            };
            stateImg.src = typeof state === "string" ? state : (state.mask || "");
        }

        const decontSrc = (typeof state === "object" && state !== null) ? state.decontImage : null;
        currentDecontImgB64 = decontSrc;
        if (decontSrc) {
            currentDecontImg = new Image();
            currentDecontImg.onload = () => requestDraw();
            currentDecontImg.src = getDecontUrl(decontSrc);
        } else {
            currentDecontImg = null;
            requestDraw();
        }

        // Synchronize main node canvas mask in real-time
        if (node.maskCanvasRef) {
            const mctx = node.maskCanvasRef.getContext("2d");
            mctx.clearRect(0, 0, imgW, imgH);
            if (state.maskCanvas) {
                mctx.drawImage(state.maskCanvas, 0, 0);
            }
            if (app.graph) app.graph.setDirtyCanvas(true, true);
        }
    }

    // ==========================================
    // CAMERA / INTERACTION (PAN-ZOOM)
    // ==========================================

    function getFitScale() {
        const rect = canvasContainer.getBoundingClientRect();
        const aspect = imgH / imgW;
        let scale = (rect.width * 0.85) / imgW;
        if (imgW * scale * aspect > rect.height * 0.85) {
            scale = (rect.height * 0.85) / imgH;
        }
        return scale;
    }

    function resizeCanvas(forceCenter = false) {
        const rect = canvasContainer.getBoundingClientRect();
        editorCanvas.width = rect.width;
        editorCanvas.height = rect.height;
        
        if (isFirstLaunch || forceCenter) {
            const fitScale = getFitScale();
            camera.zoom = fitScale;
            baseFitScale = fitScale;
            camera.x = (rect.width - imgW * camera.zoom) / 2;
            camera.y = (rect.height - imgH * camera.zoom) / 2;
            isFirstLaunch = false;
        } else {
            if (lastContainerW && lastContainerH) {
                const dw = rect.width - lastContainerW;
                const dh = rect.height - lastContainerH;
                camera.x += dw / 2;
                camera.y += dh / 2;
            }
        }
        
        lastContainerW = rect.width;
        lastContainerH = rect.height;
        
        if (typeof updateRecenterBtnText === "function") updateRecenterBtnText();
        requestDraw();
    }

    function getImgCoord(clientX, clientY) {
        const rect = editorCanvas.getBoundingClientRect();
        const mx = clientX - rect.left;
        const my = clientY - rect.top;
        const x = (mx - camera.x) / camera.zoom;
        const y = (my - camera.y) / camera.zoom;
        return { x, y };
    }

    // Rendering Frame (RAF)
    function requestDraw() {
        if (isDrawingRAF) return;
        isDrawingRAF = true;
        requestAnimationFrame(() => {
            drawCanvasContent();
            isDrawingRAF = false;
        });
    }

    // Render Grow/Blur parameters to target canvas before drawing
    function drawCanvasContent() {
        if (typeof updateRecenterBtnText === "function") updateRecenterBtnText();
        const ctx = editorCanvas.getContext("2d");
        ctx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
        
        ctx.save();
        ctx.translate(camera.x, camera.y);
        ctx.scale(camera.zoom, camera.zoom);
        
        // 1. Draw base image
        if (currentDecontImg && currentDecontImg.complete) {
            ctx.drawImage(currentDecontImg, 0, 0);
        } else {
            ctx.drawImage(origImgObj, 0, 0);
        }

        // 2. Draw mask layer on top (with real-time grow/blur PREVIEW)
        if (showMask) {
            if (node._maskFiltersDirty) {
                const previewGrow = growBlurPanelVisible ? parseInt(growSlider.value, 10) : 0;
                const previewBlur = growBlurPanelVisible ? parseInt(blurSlider.value, 10) : 0;
                const previewFill = growBlurPanelVisible ? parseInt(fillHolesSlider.value, 10) : 0;
                const previewSmooth = growBlurPanelVisible ? parseInt(smoothEdgesSlider.value, 10) : 0;
                if (previewGrow !== 0 || previewBlur !== 0 || previewFill !== 0 || previewSmooth !== 0) {
                    // Real-time preview: apply grow/blur/fill/smooth to tempCanvas for display only
                    applyGrowBlur(tempCtx, previewGrow, previewBlur, previewFill, previewSmooth);
                } else {
                    // No filters — just copy rawMaskCanvas
                    tempCtx.clearRect(0, 0, imgW, imgH);
                    tempCtx.drawImage(rawMaskCanvas, 0, 0);
                }
                node._maskFiltersDirty = false;
            }
            
            // Draw onto visible canvas
            ctx.save();
            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = node._visualOpacityEditor !== undefined ? node._visualOpacityEditor : 0.65;
            ctx.drawImage(tempCanvas, 0, 0);
            ctx.restore();
        }

        // Draw SAM hover preview if active
        if (samBtn.isActive && samHoverCanvas) {
            ctx.save();
            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = 0.45;
            ctx.drawImage(samHoverCanvas, 0, 0);
            ctx.restore();
        }

        // Draw SAM PRO crop box visual guide if active
        if (samBtn.isActive && proBtn.isActive) {
            const cropBox = getSAMProCropBox();
            ctx.save();
            // 1. Draw dimming overlay outside the crop box
            ctx.fillStyle = "rgba(0, 0, 0, 0.45)"; // 45% black transparency
            // Top rect
            ctx.fillRect(0, 0, imgW, cropBox.y);
            // Bottom rect
            ctx.fillRect(0, cropBox.y + cropBox.height, imgW, imgH - (cropBox.y + cropBox.height));
            // Left rect
            ctx.fillRect(0, cropBox.y, cropBox.x, cropBox.height);
            // Right rect
            ctx.fillRect(cropBox.x + cropBox.width, cropBox.y, imgW - (cropBox.x + cropBox.width), cropBox.height);

            // 2. Draw sky blue guide line
            ctx.strokeStyle = "rgba(0, 191, 255, 0.85)"; // Sky blue guide line
            ctx.lineWidth = 2.0 / camera.zoom;
            ctx.setLineDash([6 / camera.zoom, 4 / camera.zoom]);
            ctx.strokeRect(cropBox.x, cropBox.y, cropBox.width, cropBox.height);
            ctx.restore();
        }

        // 3. Draw brush outline cursor dynamically
        if (currentMouseImgPos && !samBtn.isActive && !isPanning) {
            ctx.save();
            // Draw outer circle of brush
            ctx.beginPath();
            ctx.arc(currentMouseImgPos.x, currentMouseImgPos.y, brushSize / 2, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
            ctx.lineWidth = 1.0 / camera.zoom;
            ctx.stroke();

            // Draw inner circle for brush hardness threshold
            if (brushHardness < 1.0 && brushHardness > 0) {
                ctx.beginPath();
                ctx.arc(currentMouseImgPos.x, currentMouseImgPos.y, (brushSize * brushHardness) / 2, 0, Math.PI * 2);
                ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
                ctx.lineWidth = 0.75 / camera.zoom;
                ctx.stroke();
            }

            // Draw center dot
            ctx.beginPath();
            ctx.arc(currentMouseImgPos.x, currentMouseImgPos.y, 1.0 / camera.zoom, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
            ctx.fill();
            ctx.restore();
        }
        
        // 4. Draw temporary SAM RMB line
        if (samRmbDrawing && samRmbPoints && samRmbPoints.length > 1) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(samRmbPoints[0].x, samRmbPoints[0].y);
            for (let i = 1; i < samRmbPoints.length; i++) {
                ctx.lineTo(samRmbPoints[i].x, samRmbPoints[i].y);
            }
            ctx.strokeStyle = "white";
            ctx.lineWidth = 3 / camera.zoom;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.globalCompositeOperation = "difference";
            ctx.stroke();
            ctx.restore();
        }
        
        ctx.restore();
    }

    // ==========================================
    // CANVAS INTERACTIVE LISTENERS (PointerEvents & Escape Key)
    // ==========================================

    // Escape & Ctrl+Z/Y Listener bound to AbortController signal
    const handleKeyDown = (e) => {
        if (node._isUIBlocked) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.code === 'KeyZ' || e.keyCode === 90)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (e.shiftKey) {
                applyHistory(historyIndex + 1);
            } else {
                applyHistory(historyIndex - 1);
            }
            return;
        }

        if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || e.code === 'KeyY' || e.keyCode === 89)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            applyHistory(historyIndex + 1);
            return;
        }

        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (isDownloadingSAM || isDownloadingBG) {
                alert("Please wait for the model download to complete. Do not close the editor or reload the page.");
                return;
            }
            saveMask();
            return;
        }

        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "SELECT" || activeEl.tagName === "TEXTAREA")) {
            if (e.key !== "Escape") return;
        }

        // Brackets to adjust brush size
        if (e.key === "[" || e.key === "]" || e.code === "BracketLeft" || e.code === "BracketRight" || e.keyCode === 219 || e.keyCode === 221) {
            e.preventDefault();
            e.stopPropagation();
            let newSize = brushSize;
            if (e.key === "[" || e.code === "BracketLeft" || e.keyCode === 219) {
                newSize = Math.max(1, brushSize - 5);
            } else {
                newSize = Math.min(250, brushSize + 5);
            }
            brushSize = newSize;
            sizeInput.value = brushSize;
            sizeLabel.innerText = `Size: ${Math.round(brushSize)}`;
            requestDraw();
            return;
        }

        // X to toggle brush/eraser
        if (e.key === "x" || e.key === "X" || e.code === "KeyX" || e.keyCode === 88) {
            e.preventDefault();
            e.stopPropagation();
            isEraser = !isEraser;
            samBtn.isActive = false;
            updateSAMUI();
            
            if (isEraser) {
                eraserBtn.isActive = true;
                drawBtn.isActive = false;
            } else {
                eraserBtn.isActive = false;
                drawBtn.isActive = true;
            }
            if (drawBtn.updateStyle) drawBtn.updateStyle();
            if (eraserBtn.updateStyle) eraserBtn.updateStyle();
            return;
        }
    };
    const handleKeyUp = (e) => {
        if (node._isUIBlocked) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.code === 'KeyZ' || e.keyCode === 90)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || e.code === 'KeyY' || e.keyCode === 89)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return;
        }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true, signal });
    window.addEventListener("keyup", handleKeyUp, { capture: true, signal });
    window.addEventListener("resize", () => resizeCanvas(), { signal });

    editorCanvas.addEventListener("contextmenu", (e) => e.preventDefault(), { signal });

    editorCanvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        if (node._isUIBlocked) return;
        const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
        const rect = editorCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const oldZoom = camera.zoom;
        camera.zoom *= zoomDelta;
        camera.zoom = Math.max(0.05, Math.min(camera.zoom, 15));
        camera.x = mx - (mx - camera.x) * (camera.zoom / oldZoom);
        camera.y = my - (my - camera.y) * (camera.zoom / oldZoom);
        if (typeof updateRecenterBtnText === "function") updateRecenterBtnText();
        requestDraw();
    }, { signal });

    editorCanvas.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        const { x: curX, y: curY } = getImgCoord(e.clientX, e.clientY);
        currentMouseImgPos = { x: curX, y: curY };
        if (node._isUIBlocked) {
            e.preventDefault();
            return;
        }
        
        if (e.button === 1 || (e.button === 0 && e.altKey)) {
            isPanning = true;
            startMx = e.clientX; startMy = e.clientY;
            e.preventDefault(); return;
        }

        // Alt + RMB Resize
        if (e.button === 2 && e.altKey) {
            resizingBrush = true;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            accumulatedMovementX = 0;
            accumulatedMovementY = 0;
            initialBrushSize = brushSize;
            initialBrushHardness = brushHardness;
            resizeAxisLock = null;
            
            const { x, y } = getImgCoord(e.clientX, e.clientY);
            node._lockedImgX = x;
            node._lockedImgY = y;
            
            if (editorCanvas.requestPointerLock) {
                editorCanvas.requestPointerLock();
            }
            e.preventDefault();
            return;
        }

        // Ctrl + Click Flood Fill
        if (e.button === 0 && e.ctrlKey) {
            const { x, y } = getImgCoord(e.clientX, e.clientY);
            if (x >= 0 && x < imgW && y >= 0 && y < imgH) {
                doFloodFillWorker(x, y);
            }
            e.preventDefault();
            return;
        }

        if (e.button !== 0 && e.button !== 2) return;

        try { editorCanvas.setPointerCapture(e.pointerId); } catch(err){}

        if (samBtn.isActive) {
            if (isDownloadingSAM) {
                alert("Please wait for the Segment Anything model download to complete. Do not close the editor or reload the page.");
                e.preventDefault();
                return;
            }
            if (e.button === 2) {
                samRmbDrawing = true;
                samRmbPoints = [getImgCoord(e.clientX, e.clientY)];
                clearSAMHover();
                requestDraw();
                e.preventDefault();
                return;
            }
            
            const { x, y } = getImgCoord(e.clientX, e.clientY);
            if (x >= 0 && x < imgW && y >= 0 && y < imgH) {
                if (samHoverCanvas && samHoverCoords) {
                    const dx = x - samHoverCoords.x;
                    const dy = y - samHoverCoords.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist <= 15) {
                        // Instantly commit the hover preview
                        rawCtx.save();
                        rawCtx.globalCompositeOperation = "source-over";
                        rawCtx.drawImage(samHoverCanvas, 0, 0);
                        rawCtx.restore();
                        saveHistory();
                        clearSAMHover();
                        requestDraw();
                        e.preventDefault();
                        return;
                    }
                }
                clearSAMHover();
                runSAMPredict(x, y);
            }
            e.preventDefault();
            return;
        }

        isDrawing = true;
        node._isRmbErasing = (e.button === 2);
        wasShiftDrawing = e.shiftKey;
        const { x, y } = getImgCoord(e.clientX, e.clientY);

        if (e.shiftKey && lastClickPos) {
            lastLp = [lastClickPos.x, lastClickPos.y];
            drawBrushStroke(x, y);
        } else {
            lastLp = null;
            drawBrushStroke(x, y);
        }

        lastLp = [x, y];
        lastClickPos = { x, y };
        dragStartX = x;
        dragStartY = y;
        shiftLockAxis = null;

        requestDraw();
        e.preventDefault();
    }, { signal });

    editorCanvas.addEventListener("pointermove", (e) => {
        e.stopPropagation();
        
        const { x, y } = getImgCoord(e.clientX, e.clientY);
        currentMouseImgPos = { x, y };

        if (samRmbDrawing) {
            samRmbPoints.push({ x, y });
            requestDraw();
            e.preventDefault();
            return;
        }

        if (isPanning) {
            camera.x += e.clientX - startMx;
            camera.y += e.clientY - startMy;
            startMx = e.clientX; startMy = e.clientY;
            requestDraw();
            e.preventDefault();
            return;
        }

        if (resizingBrush) {
            let deltaX = 0; let deltaY = 0;
            if (document.pointerLockElement === editorCanvas) { 
                accumulatedMovementX += (e.movementX || 0);
                accumulatedMovementY += (e.movementY || 0); 
                deltaX = accumulatedMovementX;
                deltaY = accumulatedMovementY;
            } else {
                deltaX = e.clientX - resizeStartX;
                deltaY = e.clientY - resizeStartY;
            }
            
            if (!resizeAxisLock) {
                if (Math.abs(deltaX) > 5) resizeAxisLock = 'x';
                else if (Math.abs(deltaY) > 5) resizeAxisLock = 'y';
            }
            
            if (resizeAxisLock === 'x') { 
                let newSize = initialBrushSize + (deltaX * 0.5); 
                newSize = Math.max(1, Math.min(250, newSize)); 
                brushSize = newSize;
                sizeInput.value = brushSize;
                sizeLabel.innerText = `Size: ${Math.round(brushSize)}`;
            } else if (resizeAxisLock === 'y') { 
                let newHardness = initialBrushHardness + (deltaY * 0.005); 
                newHardness = Math.max(0, Math.min(1, newHardness)); 
                brushHardness = newHardness;
                hardnessInput.value = Math.round(brushHardness * 100);
                hardnessLabel.innerText = `Hardness: ${Math.round(brushHardness * 100)}%`;
            }
            
            currentMouseImgPos = { x: node._lockedImgX, y: node._lockedImgY };
            requestDraw();
            e.preventDefault();
            return;
        }

        if (!isDrawing) {
            if (samBtn.isActive && node.properties.samLiveMode && x >= 0 && x < imgW && y >= 0 && y < imgH && !isDownloadingSAM) {
                if (samHoverTimeout) {
                    clearTimeout(samHoverTimeout);
                }
                samHoverTimeout = setTimeout(() => {
                    if (samHoverAbortCtrl) {
                        samHoverAbortCtrl.abort();
                    }
                    samHoverAbortCtrl = new AbortController();
                    const currentSig = samHoverAbortCtrl.signal;

                    const nodeImgVal = getSAMImageParam();
                    const selectedModel = samSelect.value;

                    fetch('/trix/sam_predict', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            image: nodeImgVal,
                            model: selectedModel,
                            x: x,
                            y: y,
                            threshold: parseFloat(samThreshSlider.value),
                            device: samDeviceSelect.value,
                            is_hover: true,
                            pro: proBtn.isActive,
                            image_width: imgW,
                            image_height: imgH,
                            pro_crop: proBtn.isActive ? getSAMProCropBox() : null
                        }),
                        signal: currentSig
                    })
                    .then(res => res.json())
                    .then(result => {
                        if (currentSig.aborted) return;
                        if (result.status === "success") {
                            const samMask = new Image();
                            samMask.onload = () => {
                                if (currentSig.aborted) return;
                                const alphaMask = convertGrayscaleToAlpha(samMask);
                                samHoverCanvas = alphaMask;
                                samHoverCoords = { x, y };
                                requestDraw();
                            };
                            samMask.src = "data:image/png;base64," + result.mask;
                        }
                    })
                    .catch(err => {
                        if (err.name !== 'AbortError') {
                            console.error("SAM hover prediction failed", err);
                        }
                    });
                }, 70);
            } else {
                if (samBtn.isActive) {
                    clearSAMHover();
                }
            }
            requestDraw();
            return;
        }

        if (wasShiftDrawing && !e.shiftKey) {
            isDrawing = false;
            shiftLockAxis = null;
            wasShiftDrawing = false;
            saveHistory();
            requestDraw();
            return;
        }

        let drawX = x;
        let drawY = y;
        if (e.shiftKey) {
            wasShiftDrawing = true;
            if (!shiftLockAxis) {
                if (Math.abs(drawX - dragStartX) > Math.abs(drawY - dragStartY)) {
                    shiftLockAxis = 'y';
                } else if (Math.abs(drawY - dragStartY) > Math.abs(drawX - dragStartX)) {
                    shiftLockAxis = 'x';
                }
            }
            if (shiftLockAxis === 'y') {
                drawY = dragStartY;
            } else if (shiftLockAxis === 'x') {
                drawX = dragStartX;
            }
        } else {
            shiftLockAxis = null;
            dragStartX = drawX;
            dragStartY = drawY;
        }

        drawBrushStroke(drawX, drawY);
        lastLp = [drawX, drawY];
        requestDraw();
        e.preventDefault();
    }, { signal });

    const handlePointerUp = (e) => {
        const { x: curX, y: curY } = getImgCoord(e.clientX, e.clientY);
        currentMouseImgPos = { x: curX, y: curY };
        if (isPanning) {
            isPanning = false;
        }
        if (resizingBrush) {
            resizingBrush = false;
            if (document.pointerLockElement === editorCanvas) {
                document.exitPointerLock();
            }
            e.preventDefault();
        }
        if (samRmbDrawing && e.button === 2) {
            samRmbDrawing = false;
            try { editorCanvas.releasePointerCapture(e.pointerId); } catch(err){}
            
            let sampledPoints = [];
            if (samRmbPoints.length > 0) {
                sampledPoints.push(samRmbPoints[0]);
                let lastPt = samRmbPoints[0];
                for (let i = 1; i < samRmbPoints.length; i++) {
                    const pt = samRmbPoints[i];
                    const dx = pt.x - lastPt.x;
                    const dy = pt.y - lastPt.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist >= 50) {
                        sampledPoints.push(pt);
                        lastPt = pt;
                    }
                }
                const lastSampled = sampledPoints[sampledPoints.length - 1];
                const finalPt = samRmbPoints[samRmbPoints.length - 1];
                const dx = finalPt.x - lastSampled.x;
                const dy = finalPt.y - lastSampled.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 10 && finalPt !== lastSampled) {
                    sampledPoints.push(finalPt);
                }
            }
            
            if (sampledPoints.length > 10) {
                const step = (sampledPoints.length - 1) / 9;
                const downsampled = [];
                for (let i = 0; i < 10; i++) {
                    const idx = Math.round(i * step);
                    downsampled.push(sampledPoints[idx]);
                }
                sampledPoints = downsampled;
            }
            
            samRmbPoints = [];
            requestDraw();
            
            if (sampledPoints.length > 0) {
                runSAMBatchPredict(sampledPoints);
            }
            e.preventDefault();
            return;
        }
        if (isDrawing) {
            isDrawing = false;
            try { editorCanvas.releasePointerCapture(e.pointerId); } catch(err){}
            saveHistory();
            requestDraw();
        }
    };
    editorCanvas.addEventListener("pointerup", handlePointerUp, { signal });
    editorCanvas.addEventListener("pointercancel", handlePointerUp, { signal });
    editorCanvas.addEventListener("pointerleave", (e) => {
        currentMouseImgPos = null;
        clearSAMHover();
        requestDraw();
    }, { signal });

    const drawBrushStroke = (currX, currY) => {
        node._maskFiltersDirty = true;
        rawCtx.save();
        rawCtx.lineWidth = brushSize;
        rawCtx.lineCap = "round";
        rawCtx.lineJoin = "round";
        
        // Right button or Eraser mode erases
        rawCtx.globalCompositeOperation = (isEraser || node._isRmbErasing) ? "destination-out" : "source-over";
        
        const blurAmount = (1 - brushHardness) * (brushSize / 4);
        const drawSize = Math.max(1, brushSize - blurAmount);
        
        if (blurAmount > 0) {
            const offset = Math.max(imgW, imgH) + brushSize + 500;
            rawCtx.shadowBlur = blurAmount;
            rawCtx.shadowColor = maskColor;
            rawCtx.shadowOffsetX = offset;
            rawCtx.shadowOffsetY = offset;
            rawCtx.strokeStyle = "rgba(0,0,0,1)"; // Dummy color offset outside canvas, shadow will be at original pos
            rawCtx.fillStyle = "rgba(0,0,0,1)";
            
            rawCtx.beginPath();
            if (lastLp) {
                rawCtx.moveTo(lastLp[0] - offset, lastLp[1] - offset);
                rawCtx.lineTo(currX - offset, currY - offset);
                rawCtx.stroke();
            } else {
                rawCtx.arc(currX - offset, currY - offset, drawSize / 2, 0, Math.PI * 2);
                rawCtx.fill();
            }
        } else {
            rawCtx.shadowBlur = 0;
            rawCtx.strokeStyle = maskColor;
            rawCtx.fillStyle = maskColor;
            rawCtx.beginPath();
            if (lastLp) {
                rawCtx.moveTo(lastLp[0], lastLp[1]);
                rawCtx.lineTo(currX, currY);
                rawCtx.stroke();
            } else {
                rawCtx.arc(currX, currY, drawSize / 2, 0, Math.PI * 2);
                rawCtx.fill();
            }
        }
        rawCtx.restore();
    };

    const doFloodFillWorker = (startX, startY) => {
        lockUI();
        return new Promise((resolve) => {
            const w = imgW;
            const h = imgH;
            startX = Math.floor(startX);
            startY = Math.floor(startY);
            
            if (startX < 0 || startX >= w || startY < 0 || startY >= h) {
                unlockUI();
                resolve();
                return;
            }
            
            let fillR = 0, fillG = 0, fillB = 0, fillA = 0;
            if (!isEraser) {
                const hex = maskColor.replace(/^#/, "");
                const bigint = parseInt(hex, 16);
                fillR = (bigint >> 16) & 255;
                fillG = (bigint >> 8) & 255;
                fillB = bigint & 255;
                fillA = 255;
            }
            
            showStatus("Applying flood fill...");
            const imgData = rawCtx.getImageData(0, 0, w, h);
            
            const workerCode = `
                self.onmessage = function(e) {
                    const { imgData, startX, startY, fillR, fillG, fillB, fillA, tolerance, w, h } = e.data;
                    const pixels = imgData.data;
                    const startIdx = (startY * w + startX) * 4;
                    const sr = pixels[startIdx];
                    const sg = pixels[startIdx + 1];
                    const sb = pixels[startIdx + 2];
                    const sa = pixels[startIdx + 3];
                    
                    if (Math.abs(sr - fillR) <= tolerance && Math.abs(sg - fillG) <= tolerance && Math.abs(sb - fillB) <= tolerance && Math.abs(sa - fillA) <= tolerance) {
                        self.postMessage(imgData);
                        return;
                    }
                    
                    const saWeight = sa / 255.0;
                    const psr = sr * saWeight;
                    const psg = sg * saWeight;
                    const psb = sb * saWeight;
                    const stack = [startX, startY];
                    const filledMap = new Uint8Array(w * h);
                    
                    const match = (idx) => {
                        const r = pixels[idx], g = pixels[idx+1], b = pixels[idx+2], a = pixels[idx+3];
                        const aWeight = a / 255.0;
                        return (Math.abs((r * aWeight) - psr) <= tolerance && Math.abs((g * aWeight) - psg) <= tolerance && Math.abs((b * aWeight) - psb) <= tolerance && Math.abs(a - sa) <= tolerance);
                    };
                    
                    while (stack.length > 0) {
                        const y = stack.pop();
                        const x = stack.pop();
                        let lx = x;
                        while (lx >= 0 && match((y * w + lx) * 4)) lx--;
                        lx++;
                        let rx = x;
                        while (rx < w && match((y * w + rx) * 4)) rx++;
                        rx--;
                        
                        let spanUp = false;
                        let spanDown = false;
                        for (let i = lx; i <= rx; i++) {
                            const pixelIdx = y * w + i;
                            const dataIdx = pixelIdx * 4;
                            pixels[dataIdx] = fillR;
                            pixels[dataIdx+1] = fillG;
                            pixels[dataIdx+2] = fillB;
                            pixels[dataIdx+3] = fillA;
                            filledMap[pixelIdx] = 1;
                            
                            if (y > 0) {
                                if (match(((y - 1) * w + i) * 4)) {
                                    if (!spanUp) {
                                        stack.push(i, y - 1);
                                        spanUp = true;
                                    }
                                } else {
                                    spanUp = false;
                                }
                            }
                            if (y < h - 1) {
                                if (match(((y + 1) * w + i) * 4)) {
                                    if (!spanDown) {
                                        stack.push(i, y + 1);
                                        spanDown = true;
                                    }
                                } else {
                                    spanDown = false;
                                }
                            }
                        }
                    }
                    
                    const expandRadius = 2;
                    if (expandRadius > 0) {
                        for (let y = 0; y < h; y++) {
                            for (let x = 0; x < w; x++) {
                                if (filledMap[y * w + x] === 1) {
                                    let isBorder = (x > 0 && filledMap[y * w + (x - 1)] === 0) || (x < w - 1 && filledMap[y * w + (x + 1)] === 0) || (y > 0 && filledMap[(y - 1) * w + x] === 0) || (y < h - 1 && filledMap[(y + 1) * w + x] === 0);
                                    if (isBorder) {
                                        for (let dy = -expandRadius; dy <= expandRadius; dy++) {
                                            for (let dx = -expandRadius; dx <= expandRadius; dx++) {
                                                if (dx * dx + dy * dy <= expandRadius * expandRadius) {
                                                    const nx = x + dx;
                                                    const ny = y + dy;
                                                    if (nx >= 0 && nx < w && ny >= 0 && ny < h && filledMap[ny * w + nx] === 0) {
                                                        const nidx = (ny * w + nx) * 4;
                                                        pixels[nidx] = fillR;
                                                        pixels[nidx+1] = fillG;
                                                        pixels[nidx+2] = fillB;
                                                        pixels[nidx+3] = fillA;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    self.postMessage(imgData);
                };
            `;
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            const worker = new Worker(URL.createObjectURL(blob));
            
            worker.onmessage = function(e) {
                rawCtx.putImageData(e.data, 0, 0);
                worker.terminate();
                hideStatus();
                saveHistory();
                requestDraw();
                unlockUI();
                resolve();
            };
            worker.postMessage({ imgData, startX, startY, fillR, fillG, fillB, fillA, tolerance: 200, w, h });
        });
    };


    // ==========================================
    // SAM INTERACTION (OBJECT SELECTOR)
    // ==========================================
    samBtn.onclick = async () => {
        if (isDownloadingSAM) {
            alert("Please wait for the Segment Anything model download to complete. Do not close the editor or reload the page.");
            return;
        }
        samBtn.isActive = !samBtn.isActive;
        updateSAMUI();
        if (samBtn.isActive) {
            isEraser = false;
            eraserBtn.isActive = false;
            if (eraserBtn.updateStyle) eraserBtn.updateStyle();
            drawBtn.isActive = false;
            if (drawBtn.updateStyle) drawBtn.updateStyle();
            editorCanvas.style.cursor = "crosshair";

            // Pre-check and download selected SAM model asynchronously
            const selectedModel = samSelect.value;
            await checkAndDownloadModel("sam", selectedModel);
            
            if (liveBtn.isActive) {
                preloadSAMModel();
            }
        } else {
            drawBtn.isActive = true;
            if (drawBtn.updateStyle) drawBtn.updateStyle();
            editorCanvas.style.cursor = "crosshair";
            clearSAMHover();
            requestDraw();
        }
    };

    // Inline Status Plaque next to Clear (Relocated to floating HUD overlay inside canvasContainer)
    const statusPlaque = document.createElement("div");
    statusPlaque.className = "trix-shimmer-plaque";
    statusPlaque.style.cssText = `
        position: absolute; top: 15px; left: 50%; transform: translateX(-50%);
        z-index: 100; display: none; align-items: center; gap: 8px;
        border-radius: 4px; padding: 6px 12px;
        color: #fff; font-size: 11px; font-weight: bold;
        transition: all 0.3s ease; height: 28px; box-sizing: border-box;
        pointer-events: none;
    `;
    
    const plaqueSpinner = document.createElement("div");
    plaqueSpinner.style.cssText = `
        width: 12px; height: 12px;
        border: 2px solid rgba(255,255,255,0.15);
        border-top-color: ${TRIX_ACCENT};
        border-radius: 50%;
        animation: spin 1s linear infinite;
        flex-shrink: 0;
    `;
    
    const plaqueText = document.createElement("span");
    plaqueText.style.cssText = "white-space: nowrap;";
    
    const plaqueProgressBg = document.createElement("div");
    plaqueProgressBg.style.cssText = "width: 60px; height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px; overflow: hidden; display: none; flex-shrink: 0;";
    const plaqueProgressBar = document.createElement("div");
    plaqueProgressBar.style.cssText = `width: 0%; height: 100%; background: ${TRIX_ACCENT}; transition: width 0.1s;`;
    plaqueProgressBg.appendChild(plaqueProgressBar);
    
    statusPlaque.append(plaqueSpinner, plaqueText, plaqueProgressBg);
    
    // Append status plaque to canvasContainer
    canvasContainer.appendChild(statusPlaque);

    // Keyframes for spinner (if not already added)
    if (!document.getElementById("trix-spinner-style")) {
        const style = document.createElement("style");
        style.id = "trix-spinner-style";
        style.innerHTML = "@keyframes spin { to { transform: rotate(360deg); } }";
        document.head.appendChild(style);
    }

    const showStatus = (text, hasProgress = false) => {
        plaqueText.innerText = text;
        plaqueProgressBar.style.width = "0%";
        plaqueProgressBg.style.display = hasProgress ? "block" : "none";
        statusPlaque.style.display = "flex";
        statusPlaque.style.opacity = "1";
    };
    const hideStatus = () => {
        statusPlaque.style.opacity = "0";
        setTimeout(() => {
            if (statusPlaque.style.opacity === "0") {
                statusPlaque.style.display = "none";
            }
        }, 300);
    };

    // WebSocket listener for downloads
    const downloadProgressHandler = (event) => {
        const { model_name, progress, status, error } = event.detail;
        if (status === "downloading") {
            showStatus(`Downloading model ${model_name}...`, true);
            plaqueProgressBar.style.width = `${progress}%`;
            
            sidebarBlocker.style.display = "flex";
            sidebarBlockerText.innerHTML = `
                <div style="margin-bottom: 15px; font-size: 13px; color: #aaa; text-transform: uppercase; letter-spacing: 1px;">Downloading model</div>
                <div style="font-size: 14px; font-weight: bold; color: ${TRIX_ACCENT}; word-break: break-all; margin-bottom: 25px; max-width: 100%; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">${model_name}</div>
                <div style="font-size: 32px; font-weight: 900; font-family: monospace; color: #fff; margin-bottom: 10px;">${progress}%</div>
                <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; margin-bottom: 15px;">
                    <div style="width: ${progress}%; height: 100%; background: ${TRIX_ACCENT}; transition: width 0.1s; border-radius: 3px;"></div>
                </div>
                <div style="font-size: 11px; color: #777;">Please do not close the editor</div>
            `;
            
            if (model_name === "groundingdino_swint_ogc.safetensors" || model_name.includes("sam")) {
                isDownloadingSAM = true;
            } else {
                isDownloadingBG = true;
            }
        } else if (status === "completed") {
            hideStatus();
            sidebarBlocker.style.display = "none";
            if (model_name === "groundingdino_swint_ogc.safetensors" || model_name.includes("sam")) {
                isDownloadingSAM = false;
            } else {
                isDownloadingBG = false;
            }
            const pathInfo = event.detail.save_path ? `\n\nSaved to:\n${event.detail.save_path}` : '';
            alert(`Model ${model_name} downloaded successfully!${pathInfo}`);
        } else if (status === "failed") {
            hideStatus();
            sidebarBlocker.style.display = "none";
            if (model_name === "groundingdino_swint_ogc.safetensors" || model_name.includes("sam")) {
                isDownloadingSAM = false;
            } else {
                isDownloadingBG = false;
            }
            alert(`Model download failed: ${error}`);
        }
    };
    api.addEventListener("trix-download-progress", downloadProgressHandler);

    const checkAndDownloadModel = async (type, name) => {
        try {
            const statusCheck = await fetch('/trix/model_status');
            const modelsStatus = await statusCheck.json();
            
            const exists = modelsStatus[type]?.[name];
            if (exists) return true;

            let installFolder = "";
            if (type === "sam") {
                if (name.startsWith("groundingdino_swint_ogc")) {
                    installFolder = "models\\grounding-dino";
                } else {
                    installFolder = "models\\sams";
                }
            } else if (type === "background_removal") {
                installFolder = "models\\RMBG";
            }

            const confirmDownload = confirm(`Model ${name} needs to be downloaded.\nIt will be installed in:\n${installFolder}\n\nStart download?`);
            if (!confirmDownload) {
                if (type === "sam") isDownloadingSAM = false;
                else if (type === "background_removal") isDownloadingBG = false;
                return false;
            }

            if (type === "sam") {
                isDownloadingSAM = true;
            } else if (type === "background_removal") {
                isDownloadingBG = true;
            }

            sidebarBlocker.style.display = "flex";
            sidebarBlockerText.innerHTML = `
                <div style="margin-bottom: 15px; font-size: 13px; color: #aaa; text-transform: uppercase; letter-spacing: 1px;">Initiating download</div>
                <div style="font-size: 14px; font-weight: bold; color: ${TRIX_ACCENT}; word-break: break-all; margin-bottom: 25px; max-width: 100%; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">${name}</div>
                <div style="font-size: 18px; font-weight: bold; color: #fff;">Please wait...</div>
            `;

            showStatus(`Initiating download for ${name}...`, true);
            const resp = await fetch('/trix/download_model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_type: type, model_name: name })
            });
            const respJson = await resp.json();
            
            if (respJson.status === "already_exists") {
                hideStatus();
                sidebarBlocker.style.display = "none";
                if (type === "sam") isDownloadingSAM = false;
                else if (type === "background_removal") isDownloadingBG = false;
                return true;
            }
        } catch (e) {
            console.error("Failed checking or initiating model download:", e);
            if (type === "sam") isDownloadingSAM = false;
            else if (type === "background_removal") isDownloadingBG = false;
            hideStatus();
            sidebarBlocker.style.display = "none";
            alert("Error checking/downloading model: " + e.message);
        }
        
        // Wait for completed signal (this is async via websocket, so we return false and download finishes in bg)
        return false;
    };

    const runSAMBatchPredict = async (points) => {
        if (isDownloadingSAM) {
            alert("Please wait for the Segment Anything model download to complete. Do not close the editor or reload the page.");
            return;
        }
        if (points.length === 0) return;
        const selectedModel = samSelect.value;
        const loaded = await checkAndDownloadModel("sam", selectedModel);
        if (!loaded) return;

        lockUI();
        showStatus(`Computing SAM mask...`);
        try {
            const nodeImgVal = getSAMImageParam();
            const resp = await fetch('/trix/sam_predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: nodeImgVal,
                    model: selectedModel,
                    points: points.map(pt => [pt.x, pt.y]),
                    threshold: parseFloat(samThreshSlider.value),
                    device: samDeviceSelect.value,
                    pro: proBtn.isActive,
                    image_width: imgW,
                    image_height: imgH,
                    pro_crop: proBtn.isActive ? getSAMProCropBox() : null
                })
            });
            const result = await resp.json();
            if (result.status === "success") {
                await new Promise((resolve) => {
                    const samMask = new Image();
                    samMask.onload = () => {
                        const alphaMask = convertGrayscaleToAlpha(samMask);
                        rawCtx.save();
                        rawCtx.globalCompositeOperation = "source-over";
                        rawCtx.drawImage(alphaMask, 0, 0);
                        rawCtx.restore();
                        resolve();
                    };
                    samMask.onerror = resolve;
                    samMask.src = "data:image/png;base64," + result.mask;
                });
                saveHistory();
                requestDraw();
            } else {
                alert("SAM failed: " + result.error);
            }
        } catch (e) {
            console.error(e);
            alert("Error in SAM Batch: " + e.message);
        } finally {
            hideStatus();
            unlockUI();
        }
    };

    const runSAMPredict = async (x, y) => {
        if (isDownloadingSAM) {
            alert("Please wait for the Segment Anything model download to complete. Do not close the editor or reload the page.");
            return;
        }
        const selectedModel = samSelect.value;
        const loaded = await checkAndDownloadModel("sam", selectedModel);
        if (!loaded) return;

        lockUI();
        showStatus("Segment Anything is computing mask...");
        try {
            const nodeImgVal = getSAMImageParam();
            const resp = await fetch('/trix/sam_predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: nodeImgVal,
                    model: selectedModel,
                    x: x,
                    y: y,
                    threshold: parseFloat(samThreshSlider.value),
                    device: samDeviceSelect.value,
                    pro: proBtn.isActive,
                    image_width: imgW,
                    image_height: imgH,
                    pro_crop: proBtn.isActive ? getSAMProCropBox() : null
                })
            });
            const result = await resp.json();
            if (result.status === "success") {
                const samMask = new Image();
                samMask.onload = () => {
                    const alphaMask = convertGrayscaleToAlpha(samMask);
                    // Combine onto raw mask canvas
                    rawCtx.save();
                    rawCtx.globalCompositeOperation = "source-over";
                    rawCtx.drawImage(alphaMask, 0, 0);
                    rawCtx.restore();
                    saveHistory();
                    requestDraw();
                    hideStatus();
                    unlockUI();
                };
                samMask.src = "data:image/png;base64," + result.mask;
            } else {
                hideStatus();
                unlockUI();
                alert("SAM failed: " + result.error);
            }
        } catch (e) {
            hideStatus();
            unlockUI();
            console.error(e);
            alert("Error communicating with ComfyUI SAM backend.");
        }
    };

    // ==========================================
    // BACKGROUND REMOVAL (BiRefNet & Rembg)
    // ==========================================
    bgBtn.onclick = async () => {
        if (node._isUIBlocked) return;
        if (isDownloadingBG) {
            alert("Please wait for the background removal model download to complete. Do not close the editor or reload the page.");
            return;
        }
        const selectedModel = bgSelect.value;
        const loaded = await checkAndDownloadModel("background_removal", selectedModel);
        if (!loaded) return;

        lockUI();
        showStatus("Removing background...");
        try {
            const nodeImgVal = getSAMImageParam();
            const resp = await fetch('/trix/remove_background', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: nodeImgVal,
                    model: selectedModel,
                    alpha_matting: mattingCheckbox.checked
                })
            });
            const result = await resp.json();
            if (result.status === "success") {
                const bgMask = new Image();
                bgMask.onload = () => {
                    const alphaMask = convertGrayscaleToAlpha(bgMask);
                    rawCtx.save();
                    rawCtx.globalCompositeOperation = "source-over";
                    rawCtx.drawImage(alphaMask, 0, 0);
                    rawCtx.restore();
                    saveHistory();
                    requestDraw();
                    hideStatus();
                    unlockUI();
                };
                bgMask.src = "data:image/png;base64," + result.mask;
            } else {
                hideStatus();
                unlockUI();
                alert("Background removal failed: " + result.error);
            }
        } catch (e) {
            hideStatus();
            unlockUI();
            console.error(e);
            alert("Error communicating with background removal backend.");
        }
    };

    // ==========================================
    // OUTPAINT IMAGE INTEGRATION
    // ==========================================
    outpaintBtn.onclick = () => {
        if (isDownloadingSAM || isDownloadingBG) {
            alert("Please wait for the model download to complete. Do not close the editor or reload the page.");
            return;
        }
        // Save current raw canvas data and properties to the node temporarily
        node._maskEditorBeforeOutpaint = rawMaskCanvas.toDataURL("image/png");
        node._openedFromMaskEditor = true;

        // Close Mask Editor and trigger CPO Editor
        closeEditor();
        
        const cropWidget = node.widgets.find(w => w.name === "crop_data");
        // Open the Crop Editor with Outpaint mode forced to ON
        openTrixCropEditor(node, cropWidget);
    };

    // ==========================================
    // SAVE / CLOSE HANDLERS
    // ==========================================
    function closeEditor() {
        window.removeEventListener("beforeunload", beforeUnloadHandler);
        api.removeEventListener("trix-download-progress", downloadProgressHandler);
        abortCtrl.abort();
        document.body.removeChild(overlay);
        fetch('/trix/offload', { method: 'POST' }).catch(e => console.error("Failed to offload models:", e));
    }

    async function saveMask() {
        if (isDownloadingSAM || isDownloadingBG) {
            alert("Please wait for the model download to complete. Do not close the editor or reload the page.");
            return;
        }
        if (node._isUIBlocked) return;
        lockUI();
        showStatus("Saving mask...");

        try {
            // 1. grow/blur already baked into rawMaskCanvas via Apply button — copy to tempCanvas
            tempCtx.clearRect(0, 0, imgW, imgH);
            tempCtx.drawImage(rawMaskCanvas, 0, 0);

            // Save the resulting mask to mask_data widget
            const maskDataVal = tempCanvas.toDataURL("image/png");
            
            let decontVal = currentDecontImgB64;
            const isWired = node.inputs && node.inputs.some(inp => inp.name === "in_image" && inp.link !== null);
            
            if (!isWired && currentDecontImgB64 && currentDecontImgB64.startsWith("data:")) {
                try {
                    const decontBlob = await fetch(currentDecontImgB64).then(r => r.blob());
                    const filename = trixEditedFilename(node.id);
                    const file = new File([decontBlob], filename, { type: "image/png" });
                    
                    const formData = new FormData();
                    formData.append("image", file, filename);
                    formData.append("type", "input");
                    formData.append("subfolder", TRIX_AIO_SUBFOLDER);
                    formData.append("overwrite", "true");
                    
                    const uploadResp = await fetch("/upload/image", { method: "POST", body: formData });
                    if (uploadResp.ok) {
                        const uploadJson = await uploadResp.json();
                        const fullPath = uploadJson.subfolder ? `${uploadJson.subfolder}/${uploadJson.name}` : uploadJson.name;
                        
                        const imgWidget = node.widgets ? node.widgets.find(w => w.name === "image") : null;
                        if (imgWidget) {
                            imgWidget.value = fullPath;
                            if (imgWidget.callback) imgWidget.callback(fullPath);
                        }
                        decontVal = fullPath;
                    }
                } catch (e) {
                    console.error("Failed to upload color-decontaminated image:", e);
                }
            }

            let saveVal = maskDataVal;
            if (decontVal) {
                saveVal = JSON.stringify({
                    mask: maskDataVal,
                    decont_image: decontVal
                });
            }
            const widgets = node.widgets ? node.widgets.reduce((acc, w) => ({...acc, [w.name]: w}), {}) : {};
            if (widgets.mask_data) {
                widgets.mask_data.value = saveVal;
            }

            // Sync color and visual opacity back to the standard UI
            node._colorIdx = colorIndex;
            node.maskColor = maskColor;
            node._visualOpacityStandard = node._visualOpacityEditor;
            if (node.updateColorPickBgRef) node.updateColorPickBgRef();

            // Sync brush size and hardness back to the node
            node.brushSize = brushSize;
            node.brushHardness = brushHardness;
            if (node._sizeNum) {
                node._sizeNum.value = brushSize;
                const inlineSlider = node._sizeNum.parentNode ? node._sizeNum.parentNode.querySelector("input[type=range]") : null;
                if (inlineSlider) inlineSlider.value = brushSize;
            }
            if (node._hardnessNum) {
                node._hardnessNum.value = Math.round(brushHardness * 100);
                const inlineSlider = node._hardnessNum.parentNode ? node._hardnessNum.parentNode.querySelector("input[type=range]") : null;
                if (inlineSlider) inlineSlider.value = Math.round(brushHardness * 100);
            }

            // Force the inline canvas sizes to match the editor image bounds exactly
            if (node.maskCanvasRef) {
                node.maskCanvasRef.width = imgW;
                node.maskCanvasRef.height = imgH;
                if (node.alignCanvasRef) node.alignCanvasRef();
            }

            // Redraw node canvas and update UI (with safety checks for clean ComfyUI)
            try {
                if (node.syncMaskToCanvas) {
                    await node.syncMaskToCanvas();
                }
            } catch (syncErr) {
                console.warn("TrixLoader: syncMaskToCanvas failed (non-critical):", syncErr);
            }
            if (node.saveHistoryRef) node.saveHistoryRef();
            node._trix_image_version = (node._trix_image_version || 0) + 1;
            if (node.updateUIRef) node.updateUIRef();
            if (node.updateCursorSizeRef) node.updateCursorSizeRef();
            if (typeof app !== 'undefined' && app.graph) app.graph.setDirtyCanvas(true, true);

            closeEditor();
        } catch (err) {
            console.error("Error saving mask:", err);
            alert("Error saving mask: " + err.message);
        } finally {
            hideStatus();
            unlockUI();
        }
    }

    // Load initial size of editor
    setTimeout(() => {
        if (origImgObj.complete) { resizeCanvas(); } 
        else { origImgObj.onload = resizeCanvas; }
    }, 20);

    // Check if there are any active downloads already running on the backend
    setTimeout(async () => {
        try {
            const statusCheck = await fetch('/trix/model_status');
            const modelsStatus = await statusCheck.json();
            const active = modelsStatus.active_downloads || [];
            if (active.length > 0) {
                const currentDownloadingModel = active[0];
                if (currentDownloadingModel) {
                    if (currentDownloadingModel === "groundingdino_swint_ogc.safetensors" || currentDownloadingModel.includes("sam")) {
                        isDownloadingSAM = true;
                    } else {
                        isDownloadingBG = true;
                    }
                    sidebarBlocker.style.display = "flex";
                    sidebarBlockerText.innerHTML = `
                        <div style="margin-bottom: 15px; font-size: 13px; color: #aaa; text-transform: uppercase; letter-spacing: 1px;">Downloading model</div>
                        <div style="font-size: 14px; font-weight: bold; color: ${TRIX_ACCENT}; word-break: break-all; margin-bottom: 25px; max-width: 100%; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">${currentDownloadingModel}</div>
                        <div style="font-size: 18px; font-weight: bold; color: #fff;">Restoring progress...</div>
                    `;
                }
            }
        } catch (e) {
            console.error("Failed to check active downloads on launch:", e);
        }
    }, 50);
}
