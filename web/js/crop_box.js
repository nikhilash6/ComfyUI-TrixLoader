import { app } from '../../../scripts/app.js';

const getCleanOrigBaseName = (src) => {
    if (!src) return "image";
    let filename = "";
    try {
        const url = new URL(src, window.location.origin);
        filename = url.searchParams.get("filename") || "";
    } catch(e) {
        filename = src;
    }
    let basename = filename.split('/').pop().split('\\').pop();
    let dotIdx = basename.lastIndexOf('.');
    if (dotIdx !== -1) basename = basename.substring(0, dotIdx);
    basename = basename.replace(/_(edited|masked|pasted|crop|cutout|camera_raw_HQ)_[a-zA-Z0-9_-]+_\d+/g, "");
    basename = basename.replace(/_(edited|masked|pasted|crop|cutout|camera_raw_HQ)_\d+/g, "");
    basename = basename.replace(/^(trix_crop_|trix_edited_|trix_camera_raw_HQ_|trix_cutout_|masked_)/g, "");
    basename = basename.replace(/[^a-zA-Z0-9_-]/g, "_");
    return basename || "image";
};

const TRIX_AIO_SUBFOLDER = "aio_input";
const CPO_ACCENT = "#33789a";
const CPO_ACCENT_HOVER = "#3f8eb4";
const CPO_BUTTON_BG = "#2a2a2f";
const CPO_BUTTON_HOVER = "#333a45";
const trixCropSafeId = (value) => String(value ?? "node").replace(/[^a-zA-Z0-9_-]+/g, "_") || "node";
const trixCropFilename = (nodeId, version) => `trix_edited_${trixCropSafeId(nodeId)}_${version}.png`;
const applyCpoButtonHover = (btn, isActive = () => false, base = CPO_BUTTON_BG, hover = CPO_BUTTON_HOVER) => {
    btn.onmouseenter = () => {
        if (!isActive()) {
            btn.style.background = hover;
            btn.style.color = "#fff";
        }
    };
    btn.onmouseleave = () => {
        if (isActive()) {
            btn.style.background = CPO_ACCENT;
            btn.style.color = "#fff";
        } else {
            btn.style.background = base;
            btn.style.color = base === "#333" ? "#fff" : "#ccc";
        }
    };
};
function getDecontUrl(src) {
    if (!src) return null;
    if (src.startsWith("data:") || src.startsWith("blob:") || src.startsWith("http:") || src.startsWith("https:") || src.startsWith("/")) {
        return src;
    }
    return `/view?filename=${encodeURIComponent(src)}&type=input&t=${Date.now()}`;
}

const applyCpoPrimaryHover = (btn) => {
    btn.onmouseenter = () => { btn.style.background = CPO_ACCENT_HOVER; };
    btn.onmouseleave = () => { btn.style.background = CPO_ACCENT; };
};

function getPixelLuminance(data, index) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

function findSmartSnapX(targetX, yStart, yEnd, origImageData, searchRadius = 15) {
    if (!origImageData) return targetX;
    const { data, width, height } = origImageData;
    const startY = Math.max(0, Math.min(height - 1, Math.round(yStart)));
    const endY = Math.max(0, Math.min(height - 1, Math.round(yEnd)));
    if (startY === endY) return targetX;

    const N = 30;
    const ySamples = [];
    for (let i = 0; i < N; i++) {
        ySamples.push(Math.round(startY + (i / (N - 1)) * (endY - startY)));
    }

    const minSearchX = Math.max(1, Math.min(width - 2, Math.round(targetX - searchRadius)));
    const maxSearchX = Math.max(1, Math.min(width - 2, Math.round(targetX + searchRadius)));

    const avgGrad = {};
    for (let x = minSearchX; x <= maxSearchX; x++) {
        let sumGrad = 0;
        for (const y of ySamples) {
            const idxLeft = ((y * width) + (x - 1)) * 4;
            const idxRight = ((y * width) + (x + 1)) * 4;
            const lLeft = getPixelLuminance(data, idxLeft);
            const lRight = getPixelLuminance(data, idxRight);
            sumGrad += Math.abs(lRight - lLeft);
        }
        avgGrad[x] = sumGrad / N;
    }

    const threshold = 15;
    const peaks = [];
    for (let x = minSearchX + 1; x < maxSearchX; x++) {
        const val = avgGrad[x];
        if (val > threshold && val >= avgGrad[x - 1] && val >= avgGrad[x + 1]) {
            peaks.push({ x, val });
        }
    }

    if (peaks.length > 0) {
        let closestPeak = null;
        let minCDist = Infinity;
        for (const p of peaks) {
            const dist = Math.abs(p.x - targetX);
            if (dist < minCDist) {
                minCDist = dist;
                closestPeak = p.x;
            }
        }
        if (closestPeak !== null) {
            return closestPeak;
        }
    }

    return targetX;
}

function findSmartSnapY(targetY, xStart, xEnd, origImageData, searchRadius = 15) {
    if (!origImageData) return targetY;
    const { data, width, height } = origImageData;
    const startX = Math.max(0, Math.min(width - 1, Math.round(xStart)));
    const endX = Math.max(0, Math.min(width - 1, Math.round(xEnd)));
    if (startX === endX) return targetY;

    const N = 30;
    const xSamples = [];
    for (let i = 0; i < N; i++) {
        xSamples.push(Math.round(startX + (i / (N - 1)) * (endX - startX)));
    }

    const minSearchY = Math.max(1, Math.min(height - 2, Math.round(targetY - searchRadius)));
    const maxSearchY = Math.max(1, Math.min(height - 2, Math.round(targetY + searchRadius)));

    const avgGrad = {};
    for (let y = minSearchY; y <= maxSearchY; y++) {
        let sumGrad = 0;
        for (const x of xSamples) {
            const idxTop = (((y - 1) * width) + x) * 4;
            const idxBottom = (((y + 1) * width) + x) * 4;
            const lTop = getPixelLuminance(data, idxTop);
            const lBottom = getPixelLuminance(data, idxBottom);
            sumGrad += Math.abs(lBottom - lTop);
        }
        avgGrad[y] = sumGrad / N;
    }

    const threshold = 15;
    const peaks = [];
    for (let y = minSearchY + 1; y < maxSearchY; y++) {
        const val = avgGrad[y];
        if (val > threshold && val >= avgGrad[y - 1] && val >= avgGrad[y + 1]) {
            peaks.push({ y, val });
        }
    }

    if (peaks.length > 0) {
        let closestPeak = null;
        let minCDist = Infinity;
        for (const p of peaks) {
            const dist = Math.abs(p.y - targetY);
            if (dist < minCDist) {
                minCDist = dist;
                closestPeak = p.y;
            }
        }
        if (closestPeak !== null) {
            return closestPeak;
        }
    }

    return targetY;
}

function getCropTooltipText() {
    return `⛶ Trix Crop / Pad / Outpaint — Crop & Outpaint
A workspace for cropping and extending images.

Key Features:
✦ Crop & Pad — Interactive bounding box. Drag its borders to crop or expand the image.
✦ Outpaint — Pad the original image boundaries. Adds extra pixels on the four sides (Left, Top, Right, Bottom).
✦ Outpaint Feathering — Soft mask edge blending when expanding the frame for seamless boundary matching.
✦ Keep Proportion — Select and lock aspect ratios when resizing.

⌨ Navigation & Shortcuts:
- [LMB + Drag] on frame borders — Crop/resize image
- [LMB + Drag] on empty canvas space — Pan / Move viewport
- [Mouse Wheel] — Zoom in / out`;
}

function ensureTooltipStyles() {
    if (!document.getElementById("trix-tooltip-styles")) {
        const style = document.createElement("style");
        style.id = "trix-tooltip-styles";
        style.innerHTML = `
            .trix-tooltip-container {
                position: relative;
                display: inline-flex;
                align-items: center;
                cursor: pointer;
                vertical-align: middle;
            }
            .trix-help-mark {
                width: 14px;
                height: 14px;
                border-radius: 50%;
                border: 1.5px solid #00bfff;
                color: #00bfff;
                font-size: 10px;
                font-weight: bold;
                display: flex;
                align-items: center;
                justify-content: center;
                user-select: none;
                transition: all 0.2s;
                background: transparent;
                box-sizing: border-box;
            }
            .trix-tooltip-container:hover .trix-help-mark {
                background-color: rgba(0, 191, 255, 0.2);
                box-shadow: 0 0 6px rgba(0, 191, 255, 0.5);
            }
            .trix-tooltip-text-left, .trix-tooltip-text-right {
                visibility: hidden;
                opacity: 0;
                position: fixed;
                top: 50px;
                width: 380px;
                background-color: #1a1a1e;
                border: 1.5px solid #00bfff;
                border-radius: 6px;
                padding: 12px;
                color: #e0e0e0;
                font-family: sans-serif;
                font-size: 11px;
                line-height: 1.45;
                box-shadow: 0 4px 20px rgba(0,0,0,0.8);
                z-index: 999999;
                transition: opacity 0.2s, visibility 0.2s;
                white-space: pre-line;
                pointer-events: none;
                text-transform: none;
                font-weight: normal;
                text-align: left;
            }
            .trix-tooltip-text-left {
                left: 290px;
                right: auto;
            }
            .trix-tooltip-text-right {
                right: 290px;
                left: auto;
            }
            .trix-tooltip-container:hover .trix-tooltip-text-left,
            .trix-tooltip-container:hover .trix-tooltip-text-right {
                visibility: visible;
                opacity: 1;
            }
        `;
        document.head.appendChild(style);
    }
}

export function openTrixCropBox(node, imgElement, savedMaskCanvas) {
    const abortCtrl = new AbortController();
    let camera = { x: 0, y: 0, zoom: 1 };
    let baseFitScale = 1;
    let isFirstLaunch = true;
    let lastWorkspaceW = 0;
    let lastWorkspaceH = 0;
    let isDragging = false; let dragHandle = null; 
    let startMx = 0, startMy = 0; let startCrop = null; let isPanning = false;
    let updateRecenterBtnText = null;
    if (!imgElement || !imgElement.naturalWidth) {
        alert("Please load an image first!");
        return;
    }

    const origImgObj = new Image();
    origImgObj.crossOrigin = "Anonymous";
    let opaqueSrc = imgElement.src;
    if (opaqueSrc && !opaqueSrc.startsWith("data:") && !opaqueSrc.startsWith("blob:")) {
        try {
            const url = new URL(opaqueSrc, window.location.origin);
            url.searchParams.set("channel", "rgb");
            opaqueSrc = url.toString();
        } catch(e) {}
    }
    origImgObj.src = opaqueSrc;

    let origW = imgElement.naturalWidth;
    let origH = imgElement.naturalHeight;

    let oldCropX = 0;
    let oldCropY = 0;
    
    const cropWidget = node.widgets ? node.widgets.find(w => w && w.name === "crop_data") : null;
    let opaqueImgCanvas = null;

    const getOpaqueCanvas = (img) => {
        const cvs = document.createElement("canvas");
        cvs.width = img.naturalWidth || img.width;
        cvs.height = img.naturalHeight || img.height;
        const ctx = cvs.getContext("2d");
        ctx.drawImage(img, 0, 0);
        try {
            const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
            for (let i = 0; i < imgData.data.length; i += 4) {
                imgData.data[i + 3] = 255;
            }
            ctx.putImageData(imgData, 0, 0);
        } catch(e) {
            console.error("Failed to make image opaque:", e);
        }
        return cvs;
    };

    let origImageData = null;
    const initOrigImageData = () => {
        if (!origW || !origH) return;
        opaqueImgCanvas = getOpaqueCanvas(origImgObj);
        try {
            const ctx = opaqueImgCanvas.getContext("2d");
            origImageData = ctx.getImageData(0, 0, origW, origH);
        } catch (e) {
            console.warn("Could not get image data for smart snapping (possible CORS issue):", e);
        }
    };
    node.properties = node.properties || {};
    let cropData = { x: 0, y: 0, w: origW, h: origH, color: node.properties.trix_crop_color || "#666666" };
    try {
        if (cropWidget && cropWidget.value && cropWidget.value !== "{}") {
            const parsed = JSON.parse(cropWidget.value);
            cropData = { ...cropData, ...parsed };
            oldCropX = parsed.x || 0;
            oldCropY = parsed.y || 0;
        }
    } catch(e) {}

    const overlay = document.createElement("div");
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background-color: #1a1a1a;
        background-image: linear-gradient(45deg, #222 25%, transparent 25%, transparent 75%, #222 75%, #222),
        linear-gradient(45deg, #222 25%, transparent 25%, transparent 75%, #222 75%, #222);
        background-size: 16px 16px; background-position: 0 0, 8px 8px;
        z-index: 10000; display: flex; font-family: sans-serif; user-select: none;
    `;
    overlay.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const sidebar = document.createElement("div");
    sidebar.style.cssText = `
        width: 280px; height: 100%; background: #151515; border-right: 1px solid #333;
        display: flex; flex-direction: column; padding: 20px; box-sizing: border-box;
        box-shadow: 2px 0 10px rgba(0,0,0,0.5); z-index: 10; overflow-y: auto;
    `;

    const svgTitle = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: text-bottom; margin-right: 6px;"><path d="M3 3v18h18"></path><path d="M3 15h12v-12"></path></svg>`;

    ensureTooltipStyles();
    const title = document.createElement("div");
    title.style.cssText = "color: #fff; font-size: 16px; font-weight: bold; margin-bottom: 20px; display: flex; align-items: center; gap: 6px;";
    title.innerHTML = `⛶ Trix Crop / Pad / Outpaint <span class="trix-tooltip-container"><span class="trix-help-mark">?</span><span class="trix-tooltip-text-left">${getCropTooltipText()}</span></span>`;
    
    let isLocked = false;
    let lockRatio = cropData.w / cropData.h;
    let activePreset = null;



    const presetRow = document.createElement("div");
    presetRow.style.cssText = "display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 15px;";
    const ratios = [
        { label: "1:1", val: 1/1 }, { label: "1:2", val: 1/2 }, { label: "3:2", val: 3/2 }, { label: "3:4", val: 3/4 },
        { label: "4:5", val: 4/5 }, { label: "16:9", val: 16/9 }, { label: "21:9", val: 21/9 }, { label: "32:9", val: 32/9 }
    ];
    
    const presetBtns = [];
    
    const svgLock = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: text-bottom; margin-right: 4px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
    const svgUnlock = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: text-bottom; margin-right: 4px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;

    const updateLockBtnUI = () => {
        lockBtn.innerHTML = isLocked ? `${svgLock} Locked Aspect Ratio` : `${svgUnlock} Unlock Aspect Ratio`;
        lockBtn.style.background = isLocked ? CPO_ACCENT : CPO_BUTTON_BG;
        lockBtn.style.color = isLocked ? "#fff" : "#ccc";
        wInput.style.opacity = isLocked ? "0.5" : "1";
        hInput.style.opacity = isLocked ? "0.5" : "1";
        wInput.disabled = isLocked; hInput.disabled = isLocked;
    };

    ratios.forEach(r => {
        const btn = document.createElement("button"); btn.innerText = r.label;
        btn.style.cssText = "background: #2a2a2f; color: #ccc; border: 1px solid #444; border-radius: 4px; padding: 4px 0; cursor: pointer; font-size: 10px; transition: 0.2s;";
        applyCpoButtonHover(btn, () => activePreset === r.label);
        presetBtns.push(btn);
        
        btn.onclick = () => {
            if (activePreset === r.label) {
                activePreset = null;
                isLocked = false;
                btn.style.background = CPO_BUTTON_BG;
                btn.style.color = "#ccc";
            } else {
                activePreset = r.label;
                isLocked = true;
                lockRatio = r.val;
                cropData.h = cropData.w / r.val;
                
                presetBtns.forEach(b => { b.style.background = CPO_BUTTON_BG; b.style.color = "#ccc"; });
                btn.style.background = CPO_ACCENT;
                btn.style.color = "#fff";
            }
            updateLockBtnUI();
            draw();
        };
        presetRow.appendChild(btn);
    });

    const alignContainer = document.createElement("div");
    alignContainer.style.cssText = "display: flex; flex-direction: column; margin-bottom: 15px; position: relative;";

    const alignBtn = document.createElement("button");
    const svgChevron = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left: auto;"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
    alignBtn.innerHTML = `<span style="font-size: 12px; font-weight: 500;">Alignment: Free</span>${svgChevron}`;
    alignBtn.style.cssText = "background: #2a2a2f; color: #ccc; border: 1px solid #444; border-radius: 4px; padding: 6px 10px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; width: 100%; transition: 0.2s; box-sizing: border-box;";
    applyCpoButtonHover(alignBtn);

    const dropdown = document.createElement("div");
    dropdown.style.cssText = `
        position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
        background: #151515; border: 1px solid #444; border-radius: 6px; z-index: 1000; 
        display: none; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 8px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.5); box-sizing: border-box; margin-top: 4px;
        width: 120px; aspect-ratio: 1;
    `;
    dropdown.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const options = [
        { placeholder: true },
        { label: "Top", id: "top" },
        { placeholder: true },
        { label: "Left", id: "left" },
        { label: "Center", id: "center" },
        { label: "Right", id: "right" },
        { placeholder: true },
        { label: "Bottom", id: "bottom" },
        { placeholder: true }
    ];

    const gridButtons = [];

    const updateHighlight = (activeId) => {
        gridButtons.forEach(b => {
            const isAct = b.getAttribute("data-id") === activeId;
            b.setAttribute("data-active", isAct ? "true" : "false");
            b.style.background = isAct ? CPO_ACCENT : CPO_BUTTON_BG;
        });
    };

    options.forEach(opt => {
        if (opt.placeholder) {
            const placeholder = document.createElement("div");
            placeholder.style.cssText = "visibility: hidden; aspect-ratio: 1; width: 100%;";
            dropdown.appendChild(placeholder);
            return;
        }

        const item = document.createElement("button");
        item.title = opt.label;
        item.setAttribute("data-id", opt.id);
        item.style.cssText = "background: #2a2a2f; border: 1px solid #444; border-radius: 4px; cursor: pointer; transition: 0.15s; aspect-ratio: 1; width: 100%; box-sizing: border-box; padding: 0;";
        gridButtons.push(item);

        item.onmouseenter = () => {
            const isActive = item.getAttribute("data-active") === "true";
            if (!isActive) {
                item.style.background = CPO_BUTTON_HOVER;
            }
        };
        item.onmouseleave = () => {
            const isActive = item.getAttribute("data-active") === "true";
            if (isActive) {
                item.style.background = CPO_ACCENT;
            } else {
                item.style.background = CPO_BUTTON_BG;
            }
        };

        item.onclick = (e) => {
            e.stopPropagation();
            alignBtn.querySelector("span").innerText = `Alignment: ${opt.label}`;
            dropdown.style.display = "none";
            
            updateHighlight(opt.id);
            
            const w = cropData.w;
            const h = cropData.h;
            switch(opt.id) {
                case "top":
                    cropData.x = (origW - w) / 2;
                    cropData.y = 0;
                    break;
                case "left":
                    cropData.x = 0;
                    cropData.y = (origH - h) / 2;
                    break;
                case "center":
                    cropData.x = (origW - w) / 2;
                    cropData.y = (origH - h) / 2;
                    break;
                case "right":
                    cropData.x = origW - w;
                    cropData.y = (origH - h) / 2;
                    break;
                case "bottom":
                    cropData.x = (origW - w) / 2;
                    cropData.y = origH - h;
                    break;
                default:
                    break;
            }
            if (currentSnap > 1) {
                cropData.x = Math.round(cropData.x / currentSnap) * currentSnap;
                cropData.y = Math.round(cropData.y / currentSnap) * currentSnap;
            }
            draw();
        };
        dropdown.appendChild(item);
    });

    alignBtn.onclick = (e) => {
        e.stopPropagation();
        const show = dropdown.style.display === "grid";
        dropdown.style.display = show ? "none" : "grid";
    };

    document.addEventListener("click", () => {
        dropdown.style.display = "none";
    }, { signal: abortCtrl.signal });

    alignContainer.append(alignBtn, dropdown);

    const resetAlignmentToFree = () => {
        const span = alignBtn.querySelector("span");
        if (span) span.innerText = "Alignment: Free";
        gridButtons.forEach(btn => {
            btn.setAttribute("data-active", "false");
            btn.style.background = CPO_BUTTON_BG;
        });
    };

    const transformLabel = document.createElement("div");
    transformLabel.innerText = "Mirror & Rotate";
    transformLabel.style.cssText = "color: #aaa; font-size: 11px; margin-bottom: 5px; font-weight: bold; text-transform: uppercase;";

    const transformRow = document.createElement("div");
    transformRow.style.cssText = "display: flex; gap: 4px; margin-bottom: 20px;";

    const svgMirrorH = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M12 2v20M20 16l-6-4 6-4v8zM4 16l6-4-6-4v8z"></path></svg>`;
    const svgMirrorV = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M2 12h20M16 20l-4-6-4 6h8zM16 4l-4 6-4-6h8z"></path></svg>`;
    const svgRotateCW = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`;
    const svgRotateCCW = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M1 4v6h6"></path><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>`;

    const btnMirrorH = document.createElement("button");
    btnMirrorH.innerHTML = svgMirrorH;
    btnMirrorH.title = "Mirror Horizontal";
    btnMirrorH.style.cssText = `background: ${CPO_BUTTON_BG}; color: #ccc; border: 1px solid #444; border-radius: 4px; padding: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex: 1; transition: 0.2s;`;
    applyCpoButtonHover(btnMirrorH);

    const btnMirrorV = document.createElement("button");
    btnMirrorV.innerHTML = svgMirrorV;
    btnMirrorV.title = "Mirror Vertical";
    btnMirrorV.style.cssText = `background: ${CPO_BUTTON_BG}; color: #ccc; border: 1px solid #444; border-radius: 4px; padding: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex: 1; transition: 0.2s;`;
    applyCpoButtonHover(btnMirrorV);

    const btnRotateCW = document.createElement("button");
    btnRotateCW.innerHTML = svgRotateCW;
    btnRotateCW.title = "Rotate 90° Clockwise";
    btnRotateCW.style.cssText = `background: ${CPO_BUTTON_BG}; color: #ccc; border: 1px solid #444; border-radius: 4px; padding: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex: 1; transition: 0.2s;`;
    applyCpoButtonHover(btnRotateCW);

    const btnRotateCCW = document.createElement("button");
    btnRotateCCW.innerHTML = svgRotateCCW;
    btnRotateCCW.title = "Rotate 90° Counter-Clockwise";
    btnRotateCCW.style.cssText = `background: ${CPO_BUTTON_BG}; color: #ccc; border: 1px solid #444; border-radius: 4px; padding: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex: 1; transition: 0.2s;`;
    applyCpoButtonHover(btnRotateCCW);

    const transformImage = (op) => {
        origImageData = null;
        const tempCanvas = document.createElement("canvas");
        const tempCtx = tempCanvas.getContext("2d");
        
        let newW = origW;
        let newH = origH;
        
        if (op === 'rotate-90-cw' || op === 'rotate-90-ccw') {
            newW = origH;
            newH = origW;
        }
        
        tempCanvas.width = newW;
        tempCanvas.height = newH;
        
        if (op === 'mirror-h') {
            tempCtx.translate(origW, 0);
            tempCtx.scale(-1, 1);
            tempCtx.drawImage(origImgObj, 0, 0);
        } else if (op === 'mirror-v') {
            tempCtx.translate(0, origH);
            tempCtx.scale(1, -1);
            tempCtx.drawImage(origImgObj, 0, 0);
        } else if (op === 'rotate-90-cw') {
            tempCtx.translate(newW, 0);
            tempCtx.rotate(90 * Math.PI / 180);
            tempCtx.drawImage(origImgObj, 0, 0);
        } else if (op === 'rotate-90-ccw') {
            tempCtx.translate(0, newH);
            tempCtx.rotate(-90 * Math.PI / 180);
            tempCtx.drawImage(origImgObj, 0, 0);
        }
        
        origImgObj.onload = () => {
            origImgObj.onload = null;
            const oldW = cropData.w;
            const oldH = cropData.h;
            const oldX = cropData.x;
            const oldY = cropData.y;
            
            origW = origImgObj.naturalWidth;
            origH = origImgObj.naturalHeight;
            
            if (op === 'mirror-h') {
                cropData.x = origW - oldX - oldW;
            } else if (op === 'mirror-v') {
                cropData.y = origH - oldY - oldH;
            } else if (op === 'rotate-90-cw') {
                cropData.x = origW - oldY - oldH;
                cropData.y = oldX;
                cropData.w = oldH;
                cropData.h = oldW;
            } else if (op === 'rotate-90-ccw') {
                cropData.x = oldY;
                cropData.y = origH - oldX - oldW;
                cropData.w = oldH;
                cropData.h = oldW;
            }
            
            cropData.w = Math.max(1, cropData.w);
            cropData.h = Math.max(1, cropData.h);
            
            if (isLocked) {
                lockRatio = cropData.w / cropData.h;
            }
            
            resetAlignmentToFree();
            origImageData = null;
            resizeCanvas(true);
        };
        origImgObj.src = tempCanvas.toDataURL("image/png");
    };

    btnMirrorH.onclick = () => transformImage('mirror-h');
    btnMirrorV.onclick = () => transformImage('mirror-v');
    btnRotateCW.onclick = () => transformImage('rotate-90-cw');
    btnRotateCCW.onclick = () => transformImage('rotate-90-ccw');

    transformRow.append(btnMirrorH, btnMirrorV, btnRotateCCW, btnRotateCW);

    const sizeContainer = document.createElement("div");
    sizeContainer.style.cssText = "display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;";
    
    const sizeRow = document.createElement("div");
    sizeRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; gap: 8px;";

    const svgSwap = "⇆";

    const swapBtn = document.createElement("button");
    swapBtn.innerHTML = svgSwap;
    swapBtn.style.cssText = "background: #2a2a2f; color: #ccc; border: 1px solid #444; border-radius: 4px; cursor: pointer; padding: 0 8px; height: 26px; margin-top: 15px; transition: 0.2s; font-size: 16px; font-weight: bold; line-height: 24px;";
    applyCpoButtonHover(swapBtn);
    swapBtn.onclick = () => {
        const temp = cropData.w; cropData.w = cropData.h; cropData.h = temp;
        if (isLocked) {
            lockRatio = cropData.w / cropData.h;
            activePreset = null;
            presetBtns.forEach(b => { b.style.background = CPO_BUTTON_BG; b.style.color = "#ccc"; });
        }
        draw();
    };

    const wCol = document.createElement("div");
    wCol.style.cssText = "display: flex; flex-direction: column; flex: 1;";
    const wLabel = document.createElement("span"); wLabel.innerText = "Width (W):"; wLabel.style.color = "#aaa"; wLabel.style.fontSize = "11px";
    const wInput = document.createElement("input"); wInput.type = "number"; wInput.style.cssText = "background: #000; color: #fff; border: 1px solid #444; padding: 4px; border-radius: 4px; width: 100%; box-sizing: border-box; text-align: right; outline: none; transition: 0.2s;";
    wCol.append(wLabel, wInput);

    const hCol = document.createElement("div");
    hCol.style.cssText = "display: flex; flex-direction: column; flex: 1;";
    const hLabel = document.createElement("span"); hLabel.innerText = "Height (H):"; hLabel.style.color = "#aaa"; hLabel.style.fontSize = "11px";
    const hInput = document.createElement("input"); hInput.type = "number"; hInput.style.cssText = "background: #000; color: #fff; border: 1px solid #444; padding: 4px; border-radius: 4px; width: 100%; box-sizing: border-box; text-align: right; outline: none; transition: 0.2s;";
    hCol.append(hLabel, hInput);

    sizeRow.append(swapBtn, wCol, hCol);

    wInput.oninput = () => {
        let val = parseInt(wInput.value);
        if (!isNaN(val) && val > 0) {
            cropData.w = Math.max(1, val);
            if (isLocked) {
                cropData.h = Math.max(1, Math.round(cropData.w / lockRatio));
            }
            draw();
            updateCalcInfo();
        }
    };
    wInput.onblur = () => {
        wInput.value = Math.round(cropData.w);
    };

    hInput.oninput = () => {
        let val = parseInt(hInput.value);
        if (!isNaN(val) && val > 0) {
            cropData.h = Math.max(1, val);
            if (isLocked) {
                cropData.w = Math.max(1, Math.round(cropData.h * lockRatio));
            }
            draw();
            updateCalcInfo();
        }
    };
    hInput.onblur = () => {
        hInput.value = Math.round(cropData.h);
    };

    const lockBtn = document.createElement("button");
    lockBtn.innerHTML = `${svgUnlock} Unlock Aspect Ratio`;
    lockBtn.style.cssText = "background: #2a2a2f; color: #ccc; border: 1px solid #444; border-radius: 4px; padding: 6px; cursor: pointer; font-size: 12px; transition: 0.2s;";
    applyCpoButtonHover(lockBtn, () => isLocked);
    lockBtn.onclick = () => {
        isLocked = !isLocked;
        if (!isLocked) {
            activePreset = null;
            presetBtns.forEach(b => { b.style.background = CPO_BUTTON_BG; b.style.color = "#ccc"; });
        } else {
            lockRatio = cropData.w / cropData.h;
        }
        updateLockBtnUI();
    };

    const actionRow = document.createElement("div");
    actionRow.style.cssText = "display: flex; gap: 8px;";

    const svgReset = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: text-bottom; margin-right: 4px;"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><polyline points="3 3 3 8 8 8"></polyline></svg>`;
    const svgRecenter = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: text-bottom; margin-right: 4px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4" y1="12" x2="20" y2="12"></line></svg>`;

    const resetBtn = document.createElement("button");
    resetBtn.innerHTML = `${svgReset} Reset Crop`;
    resetBtn.style.cssText = "background: #2a2a2f; color: #ccc; border: 1px solid #444; border-radius: 4px; padding: 6px; cursor: pointer; font-size: 12px; transition: 0.2s; flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px;";
    applyCpoButtonHover(resetBtn);
    resetBtn.onclick = () => {
        cropData = { x: 0, y: 0, w: origW, h: origH, color: cropData.color };
        resetAlignmentToFree();
        resizeCanvas(true);
    };

    const recenterBtn = document.createElement("button");
    recenterBtn.style.cssText = "background: #2a2a2f; color: #ccc; border: 1px solid #444; border-radius: 4px; padding: 5px 4px; cursor: pointer; font-size: 12px; transition: 0.2s; flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box;";
    applyCpoButtonHover(recenterBtn);
    recenterBtn.onclick = () => resizeCanvas(true);

    const svgIconSpan = document.createElement("span");
    svgIconSpan.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4" y1="12" x2="20" y2="12"></line></svg>`;
    svgIconSpan.style.cssText = "display: flex; align-items: center; justify-content: center; flex-shrink: 0;";

    const textCol = document.createElement("div");
    textCol.style.cssText = "display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.1;";

    const labelSpan = document.createElement("span");
    labelSpan.innerText = "Recenter";
    labelSpan.style.cssText = "font-weight: 500; font-size: 12px;";

    const pctSpan = document.createElement("span");
    pctSpan.innerText = "(100%)";
    pctSpan.style.cssText = "font-size: 10px; color: #aaa; margin-top: 1px;";

    textCol.append(labelSpan, pctSpan);
    recenterBtn.append(svgIconSpan, textCol);

    updateRecenterBtnText = () => {
        const pct = Math.round((camera.zoom / baseFitScale) * 100);
        pctSpan.innerText = `(${pct}%)`;
    };

    actionRow.append(resetBtn, recenterBtn);

    const colorRow = document.createElement("div");
    colorRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-top: 10px; margin-bottom: 10px;";

    const colorLabel = document.createElement("span");
    colorLabel.innerText = "Fill Color:";
    colorLabel.style.cssText = "color: #aaa; font-size: 12px; font-weight: bold; margin-right: auto;";

    const paletteContainer = document.createElement("div");
    paletteContainer.style.cssText = "display: flex; gap: 4px; align-items: center;";

    const standardColors = ["#000000", "#666666", "#ffffff", "#ff5555", "#ffd166", "#4ade80", "#0e7490"];
    const colorSquares = [];

    const hiddenColorInput = document.createElement("input");
    hiddenColorInput.type = "color";
    hiddenColorInput.style.display = "none";
    hiddenColorInput.value = cropData.color || "#666666";

    // Create the rainbow square first so it's accessible inside selectColor
    const rainbowSq = document.createElement("div");
    rainbowSq.style.cssText = `
        width: 18px; height: 18px; 
        background: linear-gradient(135deg, #ff5555, #ffd166, #4ade80, #0e7490);
        border-radius: 4px; cursor: pointer; box-sizing: border-box; border: 1px solid #444;
        transition: transform 0.1s, box-shadow 0.1s;
    `;

    const selectColor = (color) => {
        cropData.color = color;
        node.properties = node.properties || {};
        node.properties.trix_crop_color = color;
        if (cropWidget) {
            try {
                const curVal = JSON.parse(cropWidget.value || "{}");
                curVal.color = color;
                cropWidget.value = JSON.stringify(curVal);
            } catch(e) {
                cropWidget.value = JSON.stringify({ color: color });
            }
        }
        draw();
        
        const isStandard = standardColors.map(c => c.toLowerCase()).includes(color.toLowerCase());
        
        colorSquares.forEach(sq => {
            const sqColor = sq.getAttribute("data-color");
            if (sqColor.toLowerCase() === color.toLowerCase()) {
                sq.style.outline = "2px solid " + CPO_ACCENT;
                sq.style.outlineOffset = "1px";
            } else {
                sq.style.outline = "none";
            }
        });

        if (!isStandard) {
            rainbowSq.style.outline = "2px solid " + CPO_ACCENT;
            rainbowSq.style.outlineOffset = "1px";
        } else {
            rainbowSq.style.outline = "none";
        }
    };

    hiddenColorInput.oninput = () => {
        selectColor(hiddenColorInput.value);
    };

    // Create 7 standard color squares
    standardColors.forEach(color => {
        const sq = document.createElement("div");
        sq.setAttribute("data-color", color);
        sq.style.cssText = `
            width: 18px; height: 18px; background: ${color}; border-radius: 4px;
            cursor: pointer; box-sizing: border-box; border: 1px solid #444;
            transition: transform 0.1s, box-shadow 0.1s;
        `;
        sq.onmouseenter = () => { sq.style.transform = "scale(1.1)"; };
        sq.onmouseleave = () => { sq.style.transform = "scale(1)"; };
        sq.onclick = () => { selectColor(color); };
        paletteContainer.appendChild(sq);
        colorSquares.push(sq);
    });

    rainbowSq.onmouseenter = () => { rainbowSq.style.transform = "scale(1.1)"; };
    rainbowSq.onmouseleave = () => { rainbowSq.style.transform = "scale(1)"; };
    rainbowSq.onclick = () => {
        hiddenColorInput.click();
    };
    
    paletteContainer.appendChild(rainbowSq);
    colorRow.append(colorLabel, paletteContainer, hiddenColorInput);

    // Initial styling setup
    setTimeout(() => {
        selectColor(cropData.color || "#666666");
    }, 0);

    const outpaintRow = document.createElement("div");
    outpaintRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; background: #2a2a2a; padding: 8px 10px; margin-top: 5px; border-radius: 6px; border: 1px solid #444; box-shadow: inset 0 1px 2px rgba(0,0,0,0.4);";
    
    const outpaintLabel = document.createElement("span");
    outpaintLabel.innerText = "Auto-Mask Outpaint";
    outpaintLabel.style.cssText = "color: #fff; font-size: 12px; font-weight: bold;";

    const switchContainer = document.createElement("label");
    switchContainer.style.cssText = "position: relative; display: inline-block; width: 34px; height: 18px; margin: 0; cursor: pointer;";

    const keepPropWidget = node.widgets ? node.widgets.find(w => w.name === "keep_proportion") : null;
    let useOutpaint = keepPropWidget ? (keepPropWidget.value === "pad_for_outpainting") : false;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.style.cssText = "opacity: 0; width: 0; height: 0; position: absolute;";
    checkbox.checked = useOutpaint;

    const track = document.createElement("span");
    track.style.cssText = `position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: ${useOutpaint ? CPO_ACCENT : "#111"}; transition: .2s; border-radius: 18px; border: 1px solid #555; box-sizing: border-box;`;

    const circle = document.createElement("span");
    circle.style.cssText = `position: absolute; content: ''; height: 12px; width: 12px; left: 2px; top: 2px; background: white; transition: .2s; border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,0.5); transform: ${useOutpaint ? "translateX(16px)" : "translateX(0)"};`;

    track.appendChild(circle);
    switchContainer.append(checkbox, track);
    outpaintRow.append(outpaintLabel, switchContainer);

    const featherWidget = node.widgets ? node.widgets.find(w => w.name === "feathering") : null;
    let feathering = featherWidget ? (parseInt(featherWidget.value) || 0) : 0;

    const featherRow = document.createElement("div");
    featherRow.style.cssText = `display: ${useOutpaint ? "flex" : "none"}; align-items: center; justify-content: space-between; background: #2a2a2a; padding: 6px 10px; margin-top: 4px; border-radius: 6px; border: 1px solid #444; gap: 8px;`;

    const featherLabel = document.createElement("span");
    featherLabel.innerText = "Feathering";
    featherLabel.style.cssText = "color: #aaa; font-size: 11px; white-space: nowrap;";

    const fSlider = document.createElement("input");
    fSlider.type = "range";
    fSlider.min = "0"; fSlider.max = "250"; fSlider.value = feathering;
    fSlider.style.cssText = "flex: 1; min-width: 40px; cursor: pointer; accent-color: #33789a;";

    const fInput = document.createElement("input");
    fInput.type = "number";
    fInput.min = "0"; fInput.max = "250"; fInput.value = feathering;
    fInput.style.cssText = "background: #000; color: #fff; border: 1px solid #444; padding: 2px 4px; border-radius: 4px; width: 45px; text-align: right; outline: none; font-size: 11px;";

    const syncFeather = (val) => {
        let parsed = parseInt(val) || 0;
        parsed = Math.max(0, Math.min(250, parsed));
        feathering = parsed;
        fSlider.value = parsed;
        fInput.value = parsed;
        if (featherWidget) featherWidget.value = parsed;
    };

    fSlider.oninput = (e) => syncFeather(e.target.value);
    fInput.onchange = (e) => { syncFeather(e.target.value); };

    featherRow.append(featherLabel, fSlider, fInput);

    checkbox.onchange = (e) => {
        useOutpaint = e.target.checked;
        track.style.backgroundColor = useOutpaint ? CPO_ACCENT : "#111";
        circle.style.transform = useOutpaint ? "translateX(16px)" : "translateX(0)";
        featherRow.style.display = useOutpaint ? "flex" : "none";
    };

    sizeContainer.append(sizeRow, lockBtn, actionRow, colorRow, outpaintRow, featherRow);

    const snapSeparator = document.createElement("hr");
    snapSeparator.style.cssText = "border: none; border-top: 1px solid #333; margin: 5px 0 15px 0; width: 100%;";

    const snapLabel = document.createElement("div");
    snapLabel.innerText = "Pixel Snap";
    snapLabel.style.cssText = "color: #aaa; font-size: 11px; margin-bottom: 5px; font-weight: bold; text-transform: uppercase;";

    const snapRow = document.createElement("div");
    snapRow.style.cssText = "display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px;";
    const snaps = [1, 2, 4, 8, 32, 64];
    let currentSnap = 1;
    const snapBtns = [];
    snaps.forEach(s => {
        const btn = document.createElement("button");
        btn.innerText = s === 1 ? "None" : `x${s}`;
        btn.style.cssText = `background: ${s === 1 ? CPO_ACCENT : CPO_BUTTON_BG}; color: ${s === 1 ? '#fff' : '#ccc'}; border: 1px solid #444; border-radius: 4px; padding: 4px; cursor: pointer; font-size: 10px; flex: 1; transition: 0.2s;`;
        applyCpoButtonHover(btn, () => currentSnap === s);
        btn.onclick = () => {
            currentSnap = s;
            snapBtns.forEach(b => { b.style.background = CPO_BUTTON_BG; b.style.color = "#ccc"; });
            btn.style.background = CPO_ACCENT;
            btn.style.color = "#fff";
            cropData.w = Math.round(cropData.w / s) * s;
            cropData.h = Math.round(cropData.h / s) * s;
            cropData.x = Math.round(cropData.x / s) * s;
            cropData.y = Math.round(cropData.y / s) * s;
            draw();
        };
        snapBtns.push(btn);
        snapRow.appendChild(btn);
    });

    let useSmartSnapping = false;
    const smartSnapRow = document.createElement("div");
    smartSnapRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; background: #2a2a2a; padding: 8px 10px; margin-top: 5px; border-radius: 6px; border: 1px solid #444; box-shadow: inset 0 1px 2px rgba(0,0,0,0.4); margin-bottom: 20px;";
    
    const smartSnapLabel = document.createElement("span");
    smartSnapLabel.innerText = "Smart Edge Snapping";
    smartSnapLabel.style.cssText = "color: #fff; font-size: 12px; font-weight: bold; cursor: help;";
    smartSnapLabel.title = "Snaps crop boundaries to high-contrast image contours and visual edges instead of just image borders.";
    smartSnapRow.title = "Snaps crop boundaries to high-contrast image contours and visual edges instead of just image borders.";

    const smartSwitchContainer = document.createElement("label");
    smartSwitchContainer.style.cssText = "position: relative; display: inline-block; width: 34px; height: 18px; margin: 0; cursor: pointer;";

    const smartCheckbox = document.createElement("input");
    smartCheckbox.type = "checkbox";
    smartCheckbox.style.cssText = "opacity: 0; width: 0; height: 0; position: absolute;";
    smartCheckbox.checked = false;

    const smartTrack = document.createElement("span");
    smartTrack.style.cssText = "position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: #111; transition: .2s; border-radius: 18px; border: 1px solid #555; box-sizing: border-box;";

    const smartCircle = document.createElement("span");
    smartCircle.style.cssText = "position: absolute; content: ''; height: 12px; width: 12px; left: 2px; top: 2px; background: white; transition: .2s; border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,0.5);";

    smartTrack.appendChild(smartCircle);
    smartSwitchContainer.append(smartCheckbox, smartTrack);
    smartSnapRow.append(smartSnapLabel, smartSwitchContainer);

    smartCheckbox.onchange = (e) => {
        useSmartSnapping = e.target.checked;
        smartTrack.style.backgroundColor = useSmartSnapping ? CPO_ACCENT : "#111";
        smartCircle.style.transform = useSmartSnapping ? "translateX(16px)" : "translateX(0)";
    };

    const formatAspect = (w, h) => {
        if (!w || !h) return "[?]";
        w = Math.round(w);
        h = Math.round(h);

        // 1. Exact standard monitor resolutions mapping
        if (w === 3440 && h === 1440) return "[21:9]";
        if (w === 1440 && h === 3440) return "[9:21]";
        if (w === 2560 && h === 1080) return "[21:9]";
        if (w === 1080 && h === 2560) return "[9:21]";
        if (w === 5120 && h === 2160) return "[21:9]";
        if (w === 2160 && h === 5120) return "[9:21]";
        if (w === 3840 && h === 1600) return "[21:9]";
        if (w === 1600 && h === 3840) return "[9:21]";
        
        if (w === 5120 && h === 1440) return "[32:9]";
        if (w === 1440 && h === 5120) return "[9:32]";
        if (w === 3840 && h === 1080) return "[32:9]";
        if (w === 1080 && h === 3840) return "[9:32]";

        // 2. Exact mathematically simple standard ratios
        const gcd = (a, b) => {
            while (b) {
                const t = b;
                b = a % b;
                a = t;
            }
            return a || 1;
        };
        const divisor = gcd(w, h);
        const rw = w / divisor;
        const rh = h / divisor;
        const standards = ["1:1", "16:9", "9:16", "16:10", "10:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5"];
        const ratioStr = `${rw}:${rh}`;
        if (standards.includes(ratioStr)) {
            return `[${ratioStr}]`;
        }

        // 3. Fallback for custom cropped aspect ratios
        const cleanRatioNumber = (val) => {
            const rounded = Number(val).toFixed(2);
            return rounded.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
        };
        if (w === h) return "[1:1]";
        if (w < h) {
            return `[~1:${cleanRatioNumber(h / w)}]`;
        }
        return `[~${cleanRatioNumber(w / h)}:1]`;
    };

    const calcInfo = document.createElement("div");
    calcInfo.style.cssText = "background: #1e1e22; border: 1px solid #3d3d42; padding: 12px; border-radius: 6px; text-align: center; color: #aaa; font-family: monospace; font-size: 12px; margin-bottom: auto;";
    
    const updateCalcInfo = () => {
        const cw = Math.round(cropData.w); const ch = Math.round(cropData.h);
        const origAspect = formatAspect(origW, origH);
        const targetAspect = formatAspect(cw, ch);
        calcInfo.innerHTML = `Original<br><span style="color:#fff">${origW} x ${origH} &nbsp;${origAspect}</span><br><br>Target<br><span style="color:rgb(150, 225, 255); font-size: 14px;">${cw} x ${ch} &nbsp;${targetAspect}</span>`;
        if (!isLocked) {
            if (document.activeElement !== wInput) wInput.value = cw;
            if (document.activeElement !== hInput) hInput.value = ch;
        } else {
            wInput.value = cw;
            hInput.value = ch;
        }
    };

    const actionsWrapper = document.createElement("div");
    actionsWrapper.style.cssText = "display: flex; flex-direction: column; gap: 8px; margin-top: 20px;";





    const closeEditor = () => {
        abortCtrl.abort();
        if (document.body.contains(overlay)) {
            document.body.removeChild(overlay);
        }
    };

    const cancelBtn = document.createElement("button");
    cancelBtn.innerText = "Cancel";
    cancelBtn.style.cssText = "width: 100%; padding: 10px; background: #333; color: #fff; border: none; border-radius: 4px; cursor: pointer; transition: 0.2s; font-size: 11px;";
    applyCpoButtonHover(cancelBtn, () => false, "#333", "#444");
    cancelBtn.onclick = closeEditor;

    const saveDiskBtn = document.createElement("button");
    saveDiskBtn.innerText = "Save to Disk";
    saveDiskBtn.style.cssText = "flex: 1; padding: 10px; background: #2a2a2f; color: #fff; border: none; border-radius: 4px; cursor: pointer; transition: 0.2s; font-size: 11px;";
    applyCpoButtonHover(saveDiskBtn, () => false, CPO_BUTTON_BG, CPO_BUTTON_HOVER);
    saveDiskBtn.onclick = () => {
        node.properties = node.properties || {};
        node.properties.trix_crop_color = cropData.color;
        const tCanvas = document.createElement("canvas");
        tCanvas.width = cropData.w; tCanvas.height = cropData.h;
        const tCtx = tCanvas.getContext("2d");
        tCtx.fillStyle = cropData.color;
        tCtx.fillRect(0, 0, cropData.w, cropData.h);
        tCtx.drawImage(origImgObj, -cropData.x, -cropData.y);
        
        tCanvas.toBlob(async (blob) => {
            if (!blob) {
                console.error("Failed to create blob for saving");
                return;
            }
            const filename = `trix_crop_${Date.now()}.png`;
            if (window.showSaveFilePicker) {
                try {
                    const handle = await window.showSaveFilePicker({
                        suggestedName: filename,
                        types: [{ description: 'Image Files (*.png;*.jpg;*.jpeg;*.webp)', accept: {'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp']} }]
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
    const saveBtn = document.createElement("button");
    saveBtn.innerText = "Save to Node";
    saveBtn.style.cssText = "flex: 1; padding: 10px; background: #33789a; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; transition: 0.2s; font-size: 11px;";
    applyCpoPrimaryHover(saveBtn);
    saveBtn.onclick = () => {
        saveBtn.disabled = true;
        saveBtn.innerText = "Saving...";
        
        setTimeout(async () => {
            const origBase = getCleanOrigBaseName(imgElement.src);
            const uWgt = node.widgets ? node.widgets.find(w => w.name === "trix_uuid") : null;
            const idToUse = uWgt && uWgt.value ? uWgt.value : node.id;
            const imgWidget = node.widgets ? node.widgets.find(w => w && (w.name === "image" || w.name === "image_path")) : null;
            let nextVersion = (node._trix_image_version || 0) + 1;
            if (imgWidget && imgWidget.value) {
                const match = imgWidget.value.match(/_(\d+)\.[a-zA-Z0-9]+$/);
                if (match) {
                    const val = parseInt(match[1], 10);
                    if (!isNaN(val)) {
                        nextVersion = Math.max(val + 1, nextVersion);
                    }
                }
            }
            const filename = `${origBase}_pasted_${idToUse}_${nextVersion}.png`;
            
            cropData.x = Math.round(cropData.x); cropData.y = Math.round(cropData.y);
            cropData.w = Math.round(cropData.w); cropData.h = Math.round(cropData.h);
            
            // 1. Create a canvas for the cropped/padded image (fully opaque)
            const tCanvas = document.createElement("canvas");
            tCanvas.width = cropData.w; tCanvas.height = cropData.h;
            const tCtx = tCanvas.getContext("2d");
            tCtx.fillStyle = cropData.color;
            tCtx.fillRect(0, 0, cropData.w, cropData.h);
            
            // Draw clean base image (opaque)
            const cleanCvs = getOpaqueCanvas(origImgObj);
            tCtx.drawImage(cleanCvs, -cropData.x, -cropData.y);
            
            // 2. Crop the mask canvas in the exact same way
            const mCvs = document.createElement("canvas");
            mCvs.width = cropData.w; mCvs.height = cropData.h;
            const mCtx = mCvs.getContext("2d");
            
            // Fill with mask:
            // If useOutpaint is true, we mask the padded areas (white).
            // If useOutpaint is false, we do NOT mask the padded areas (black).
            mCtx.fillStyle = useOutpaint ? "white" : "black";
            mCtx.fillRect(0, 0, cropData.w, cropData.h);
            
            if (useOutpaint) {
                let padLeft = -cropData.x;
                let padTop = -cropData.y;
                let padRight = cropData.w - origW + cropData.x;
                let padBottom = cropData.h - origH + cropData.y;
                
                let grow = feathering * 2;
                
                // Clamp grow so that the black region never shrinks to zero width or height
                let maxGrowX = origW - 1;
                let shrinkFactorX = (padLeft > 0 ? 1 : 0) + (padRight > 0 ? 1 : 0);
                if (shrinkFactorX > 0) {
                    maxGrowX = Math.floor((origW - 1) / shrinkFactorX);
                }
                
                let maxGrowY = origH - 1;
                let shrinkFactorY = (padTop > 0 ? 1 : 0) + (padBottom > 0 ? 1 : 0);
                if (shrinkFactorY > 0) {
                    maxGrowY = Math.floor((origH - 1) / shrinkFactorY);
                }
                
                grow = Math.min(grow, maxGrowX, maxGrowY);
                grow = Math.max(0, grow);
                
                let blackX1 = padLeft + (padLeft > 0 ? grow : 0);
                let blackY1 = padTop + (padTop > 0 ? grow : 0);
                let blackX2 = padLeft + origW - (padRight > 0 ? grow : 0);
                let blackY2 = padTop + origH - (padBottom > 0 ? grow : 0);
                
                blackX1 = Math.min(blackX1, padLeft + origW);
                blackY1 = Math.min(blackY1, padTop + origH);
                blackX2 = Math.max(blackX2, padLeft);
                blackY2 = Math.max(blackY2, padTop);
                
                let clrW = blackX2 - blackX1;
                let clrH = blackY2 - blackY1;
                
                const margin = feathering * 2;
                const hCvs = document.createElement("canvas");
                hCvs.width = cropData.w + 2 * margin; hCvs.height = cropData.h + 2 * margin;
                const hCtx = hCvs.getContext("2d");
                hCtx.fillStyle = "white";
                hCtx.fillRect(0, 0, hCvs.width, hCvs.height);
                
                if (clrW > 0 && clrH > 0) {
                    hCtx.fillStyle = "black";
                    hCtx.fillRect(blackX1 + margin, blackY1 + margin, clrW, clrH);
                }
                
                const blurredCvs = document.createElement("canvas");
                blurredCvs.width = cropData.w; blurredCvs.height = cropData.h;
                const blurredCtx = blurredCvs.getContext("2d");
                if (feathering > 0) {
                    blurredCtx.filter = `blur(${feathering}px)`;
                }
                blurredCtx.drawImage(hCvs, -margin, -margin);
                
                // Force sync readback flush
                try {
                    blurredCtx.getImageData(0, 0, 1, 1);
                } catch (e) {}
                
                mCtx.drawImage(blurredCvs, 0, 0);
            } else {
                // Clear the original image bounding box (unmasked, black)
                mCtx.fillStyle = "black";
                mCtx.fillRect(-cropData.x, -cropData.y, origW, origH);
            }
            
            // Draw the saved mask on the cropped mask canvas using screen mode so black pixels don't overwrite the blurred outpaint edges
            if (savedMaskCanvas) {
                mCtx.globalCompositeOperation = "screen";
                mCtx.drawImage(savedMaskCanvas, -cropData.x, -cropData.y);
                mCtx.globalCompositeOperation = "source-over";
            }
            
            // 3. Upload both blobs using our new custom API /trix/save_image_with_mask
            tCanvas.toBlob((imgBlob) => {
                if (!imgBlob) {
                    console.error("Failed to create image blob");
                    saveBtn.disabled = false;
                    saveBtn.innerText = "Save to Node";
                    return;
                }
                
                // Force a synchronous readback/GPU render flush so that blur filter is guaranteed to be applied
                try {
                    mCtx.getImageData(0, 0, 1, 1);
                } catch (e) {
                    console.error("GPU sync error:", e);
                }
                
                mCvs.toBlob(async (maskBlob) => {
                    if (!maskBlob) {
                        console.error("Failed to create mask blob");
                        saveBtn.disabled = false;
                        saveBtn.innerText = "Save to Node";
                        return;
                    }
                    try {
                        const imgFile = new File([imgBlob], filename, { type: "image/png" });
                        const maskFile = new File([maskBlob], "mask.png", { type: "image/png" });
                        const body = new FormData();
                        body.append("image", imgFile, filename);
                        body.append("mask", maskFile, "mask.png");
                        body.append("filename", filename);
                        body.append("type", "input");
                        const isAio = node && (node.comfyClass === "TrixLoadImageAIO" || node.type === "TrixLoadImageAIO");
                        body.append("subfolder", isAio ? TRIX_AIO_SUBFOLDER : "");
                        body.append("overwrite", "true");
                        const saveEveryStep = typeof app !== "undefined" && app.ui && app.ui.settings && app.ui.settings.getSettingValue("Trix AIO Tools.Save Steps.SaveEveryStep", false);
                        const saveEveryStepPath = typeof app !== "undefined" && app.ui && app.ui.settings && app.ui.settings.getSettingValue("Trix AIO Tools.Save Steps.SaveEveryStepPath", "input/aio_input");
                        body.append("save_every_step", saveEveryStep ? "true" : "false");
                        body.append("save_every_step_path", saveEveryStepPath);
                        
                        const uploadResp = await fetch("/trix/save_image_with_mask", { method: "POST", body: body });
                        if (uploadResp.status === 200) {
                            const uploadData = await uploadResp.json();
                            const fullPath = uploadData.subfolder ? `${uploadData.subfolder}/${uploadData.name}` : uploadData.name;
                            
                            node._trix_image_version = nextVersion;
                            const imgWidget = node.widgets ? node.widgets.find(w => w && (w.name === "image" || w.name === "image_path")) : null;
                            if (imgWidget) {
                                node._isChangingImage = true;
                                if (imgWidget.options && Array.isArray(imgWidget.options.values) && !imgWidget.options.values.includes(fullPath)) {
                                    imgWidget.options.values.unshift(fullPath);
                                }
                                imgWidget.value = fullPath;
                                if (imgWidget.callback) imgWidget.callback(fullPath);
                            }
                            
                            const widgets = node.widgets ? node.widgets.reduce((acc, w) => ({...acc, [w.name]: w}), {}) : {};
                            if (widgets.keep_proportion) {
                                widgets.keep_proportion.value = useOutpaint ? "pad_for_outpainting" : "pad";
                                if (widgets.keep_proportion.callback) widgets.keep_proportion.callback(widgets.keep_proportion.value);
                            }
                            if (widgets.width) {
                                widgets.width.value = cropData.w;
                                if (widgets.width.callback) widgets.width.callback(cropData.w);
                            }
                            if (widgets.height) {
                                widgets.height.value = cropData.h;
                                if (widgets.height.callback) widgets.height.callback(cropData.h);
                            }
                            if (useOutpaint) {
                                if (widgets.enable_resize) {
                                    widgets.enable_resize.value = true;
                                    if (widgets.enable_resize.callback) widgets.enable_resize.callback(true);
                                }
                                if (widgets.feathering) {
                                    widgets.feathering.value = feathering;
                                    if (widgets.feathering.callback) widgets.feathering.callback(feathering);
                                }
                            } else {
                                if (widgets.enable_resize) {
                                    widgets.enable_resize.value = false;
                                    if (widgets.enable_resize.callback) widgets.enable_resize.callback(false);
                                }
                                if (widgets.feathering) {
                                    widgets.feathering.value = 0;
                                    if (widgets.feathering.callback) widgets.feathering.callback(0);
                                }
                            }
                            
                            if (node.syncHTMLRef) node.syncHTMLRef();
                            if (node.updateUIRef) node.updateUIRef();
                            if (app.graph) app.graph.setDirtyCanvas(true, true);
                            closeEditor();
                        } else {
                            throw new Error(`Upload failed: ${uploadResp.status}`);
                        }
                    } catch (e) {
                        console.error("Save to Node upload failed", e);
                        alert("Failed to save image to node: " + e);
                        saveBtn.disabled = false;
                        saveBtn.innerText = "Save to Node";
                    }
                }, "image/png");
            }, "image/png");
        }, 50);
    };

    const saveButtonsRow = document.createElement("div");
    saveButtonsRow.style.cssText = "display: flex; gap: 8px; width: 100%;";
    saveButtonsRow.append(saveDiskBtn, saveBtn);

    actionsWrapper.append(cancelBtn, saveButtonsRow);
    sidebar.append(title, presetRow, alignContainer, sizeContainer, snapSeparator, snapLabel, snapRow, smartSnapRow, transformLabel, transformRow, calcInfo, actionsWrapper);

    const workspace = document.createElement("div");
    workspace.style.cssText = "flex: 1; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center;";
    
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    workspace.appendChild(canvas);
    overlay.append(sidebar, workspace);
    const isPotato = app.ui.settings.getSettingValue("Trix AIO Tools. Potato PC Mode.Enabled", false);
    if (isPotato) {
        overlay.classList.add("trix-potato-pc");
    }
    document.body.appendChild(overlay);



    const getFitScale = () => {
        const fitZoomW = (canvas.width * 0.7) / cropData.w;
        const fitZoomH = (canvas.height * 0.7) / cropData.h;
        return Math.min(fitZoomW, fitZoomH);
    };

    const resizeCanvas = (forceCenter = false) => {
        canvas.width = workspace.clientWidth; canvas.height = workspace.clientHeight;
        
        if (!origImageData) initOrigImageData();
        
        if (isFirstLaunch || forceCenter) {
            const fitScale = getFitScale();
            camera.zoom = fitScale;
            baseFitScale = fitScale;
            camera.x = canvas.width / 2 - (cropData.x + cropData.w / 2) * camera.zoom;
            camera.y = canvas.height / 2 - (cropData.y + cropData.h / 2) * camera.zoom;
            isFirstLaunch = false;
        } else {
            if (lastWorkspaceW && lastWorkspaceH) {
                const dw = canvas.width - lastWorkspaceW;
                const dh = canvas.height - lastWorkspaceH;
                camera.x += dw / 2;
                camera.y += dh / 2;
            }
        }
        
        lastWorkspaceW = canvas.width;
        lastWorkspaceH = canvas.height;
        
        draw();
    };

    const draw = () => {
        if (typeof updateRecenterBtnText === "function") updateRecenterBtnText();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const imgScreenX = camera.x; const imgScreenY = camera.y;
        const imgScreenW = origW * camera.zoom; const imgScreenH = origH * camera.zoom;

        const cropScreenX = camera.x + cropData.x * camera.zoom;
        const cropScreenY = camera.y + cropData.y * camera.zoom;
        const cropScreenW = cropData.w * camera.zoom;
        const cropScreenH = cropData.h * camera.zoom;
        
        ctx.fillStyle = cropData.color;
        ctx.fillRect(cropScreenX, cropScreenY, cropScreenW, cropScreenH);

        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.drawImage(opaqueImgCanvas || origImgObj, imgScreenX, imgScreenY, imgScreenW, imgScreenH);
        ctx.restore();

        if (camera.zoom >= 8.0) {
            ctx.save();
            ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            
            const startX = Math.max(0, Math.floor(-imgScreenX / camera.zoom));
            const endX = Math.min(origW, Math.ceil((canvas.width - imgScreenX) / camera.zoom));
            const startY = Math.max(0, Math.floor(-imgScreenY / camera.zoom));
            const endY = Math.min(origH, Math.ceil((canvas.height - imgScreenY) / camera.zoom));

            for (let x = startX; x <= endX; x++) {
                let screenX = imgScreenX + x * camera.zoom;
                ctx.moveTo(screenX, imgScreenY + startY * camera.zoom);
                ctx.lineTo(screenX, imgScreenY + endY * camera.zoom);
            }
            for (let y = startY; y <= endY; y++) {
                let screenY = imgScreenY + y * camera.zoom;
                ctx.moveTo(imgScreenX + startX * camera.zoom, screenY);
                ctx.lineTo(imgScreenX + endX * camera.zoom, screenY);
            }
            ctx.stroke();
            ctx.restore();
        }

        ctx.save();
        ctx.beginPath();
        ctx.rect(cropScreenX, cropScreenY, cropScreenW, cropScreenH);
        ctx.clip();
        ctx.drawImage(opaqueImgCanvas || origImgObj, imgScreenX, imgScreenY, imgScreenW, imgScreenH);
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = "rgba(220, 220, 220, 0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cropScreenX + cropScreenW / 2, cropScreenY);
        ctx.lineTo(cropScreenX + cropScreenW / 2, cropScreenY + cropScreenH);
        ctx.moveTo(cropScreenX, cropScreenY + cropScreenH / 2);
        ctx.lineTo(cropScreenX + cropScreenW, cropScreenY + cropScreenH / 2);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        const text = `${Math.round(cropData.w)} x ${Math.round(cropData.h)}`;
        ctx.font = "bold 12px sans-serif";
        ctx.textBaseline = "middle";
        const tw = ctx.measureText(text).width;
        const th = 12;
        const padX = 8;
        const padY = 6;
        
        const boxW = tw + padX * 2;
        const boxH = th + padY * 2;
        const boxX = cropScreenX + cropScreenW / 2 - boxW / 2;
        const boxY = cropScreenY + cropScreenH / 2 - boxH - 8; 
        
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(boxX, boxY, boxW, boxH, 4);
        } else {
            ctx.rect(boxX, boxY, boxW, boxH);
        }
        ctx.fill();
        
        ctx.fillStyle = "rgb(150, 225, 255)";
        ctx.fillText(text, boxX + padX, boxY + boxH / 2);
        ctx.restore();

        ctx.strokeStyle = "#33789a";
        ctx.lineWidth = 2;
        ctx.strokeRect(cropScreenX, cropScreenY, cropScreenW, cropScreenH);

        const drawHandle = (hx, hy) => {
            ctx.fillStyle = "#33789a";
            ctx.fillRect(hx - 5, hy - 5, 10, 10);
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 1;
            ctx.strokeRect(hx - 5, hy - 5, 10, 10);
        };

        drawHandle(cropScreenX, cropScreenY);
        drawHandle(cropScreenX + cropScreenW / 2, cropScreenY);
        drawHandle(cropScreenX + cropScreenW, cropScreenY);
        drawHandle(cropScreenX + cropScreenW, cropScreenY + cropScreenH / 2);
        drawHandle(cropScreenX + cropScreenW, cropScreenY + cropScreenH);
        drawHandle(cropScreenX + cropScreenW / 2, cropScreenY + cropScreenH);
        drawHandle(cropScreenX, cropScreenY + cropScreenH);
        drawHandle(cropScreenX, cropScreenY + cropScreenH / 2);

        updateCalcInfo();
    };

    const hitTest = (mx, my) => {
        const cx = camera.x + cropData.x * camera.zoom; const cy = camera.y + cropData.y * camera.zoom;
        const cw = cropData.w * camera.zoom; const ch = cropData.h * camera.zoom;
        const t = 10;
        const inside = (x, y, tx, ty) => Math.abs(x - tx) <= t && Math.abs(y - ty) <= t;

        if (inside(mx, my, cx, cy)) return "TL";
        if (inside(mx, my, cx + cw / 2, cy)) return "T";
        if (inside(mx, my, cx + cw, cy)) return "TR";
        if (inside(mx, my, cx + cw, cy + ch / 2)) return "R";
        if (inside(mx, my, cx + cw, cy + ch)) return "BR";
        if (inside(mx, my, cx + cw / 2, cy + ch)) return "B";
        if (inside(mx, my, cx, cy + ch)) return "BL";
        if (inside(mx, my, cx, cy + ch / 2)) return "L";
        
        if (mx > cx && mx < cx + cw && my > cy && my < cy + ch) return "MOVE";
        return null;
    };

    let isDrawingRAF = false;
    const requestDraw = () => {
        if (!isDrawingRAF) {
            isDrawingRAF = true;
            requestAnimationFrame(() => {
                draw();
                isDrawingRAF = false;
            });
        }
    };

    const onWheel = (e) => {
        e.preventDefault();
        const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
        const mx = e.offsetX; const my = e.offsetY;
        const oldZoom = camera.zoom;
        camera.zoom *= zoomDelta;
        camera.zoom = Math.max(0.05, Math.min(camera.zoom, 10));
        camera.x = mx - (mx - camera.x) * (camera.zoom / oldZoom);
        camera.y = my - (my - camera.y) * (camera.zoom / oldZoom);
        requestDraw();
    };
    canvas.addEventListener("wheel", onWheel, { signal: abortCtrl.signal });

    const onKeyDown = (e) => {
        if (e.key === "Escape") {
            e.preventDefault();
            closeEditor();
        }
    };
    window.addEventListener("keydown", onKeyDown, { signal: abortCtrl.signal });

    canvas.addEventListener("mousedown", (e) => {
        if (e.button === 1 || (e.button === 0 && e.altKey)) { isPanning = true; startMx = e.clientX; startMy = e.clientY; return; }
        if (e.button !== 0) return;

        dragHandle = hitTest(e.offsetX, e.offsetY);
        if (dragHandle) {
            isDragging = true;
            startMx = e.clientX; startMy = e.clientY;
            startCrop = { ...cropData };
        }
    }, { signal: abortCtrl.signal });

    canvas.addEventListener("mousemove", (e) => {
        if (isPanning) {
            camera.x += e.clientX - startMx; camera.y += e.clientY - startMy;
            startMx = e.clientX; startMy = e.clientY; requestDraw(); return;
        }

        if (!isDragging) {
            const hover = hitTest(e.offsetX, e.offsetY);
            if (hover === "TL" || hover === "BR") canvas.style.cursor = "nwse-resize";
            else if (hover === "TR" || hover === "BL") canvas.style.cursor = "nesw-resize";
            else if (hover === "T" || hover === "B") canvas.style.cursor = "ns-resize";
            else if (hover === "L" || hover === "R") canvas.style.cursor = "ew-resize";
            else if (hover === "MOVE") canvas.style.cursor = "move";
            else canvas.style.cursor = "default";
            return;
        }

        let dx = (e.clientX - startMx) / camera.zoom;
        let dy = (e.clientY - startMy) / camera.zoom;

        resetAlignmentToFree();

        const snapThresh = (10 / 3) / camera.zoom; 
        
        if (dragHandle === "MOVE") {
            if (Math.abs(startCrop.x + dx) < snapThresh) dx = -startCrop.x;
            else if (Math.abs(startCrop.x + startCrop.w + dx - origW) < snapThresh) dx = origW - (startCrop.x + startCrop.w);
            
            if (Math.abs(startCrop.y + dy) < snapThresh) dy = -startCrop.y;
            else if (Math.abs(startCrop.y + startCrop.h + dy - origH) < snapThresh) dy = origH - (startCrop.y + startCrop.h);
            
            cropData.x = startCrop.x + dx; 
            cropData.y = startCrop.y + dy;
            
            if (currentSnap > 1) {
                cropData.x = Math.round(cropData.x / currentSnap) * currentSnap;
                cropData.y = Math.round(cropData.y / currentSnap) * currentSnap;
            }
        } else {
            if (useSmartSnapping && origImageData) {
                const searchRadius = Math.max(2, 15 / camera.zoom);
                if (dragHandle.includes("L") || dragHandle.includes("R")) {
                    const edgeX = dragHandle.includes("L") ? (startCrop.x + dx) : (startCrop.x + startCrop.w + dx);
                    let yStart = startCrop.y;
                    let yEnd = startCrop.y + startCrop.h;
                    if (dragHandle.includes("T")) yStart += dy;
                    if (dragHandle.includes("B")) yEnd += dy;
                    
                    const snappedX = findSmartSnapX(edgeX, yStart, yEnd, origImageData, searchRadius);
                    if (snappedX !== edgeX) {
                        dx = snappedX - (dragHandle.includes("L") ? startCrop.x : (startCrop.x + startCrop.w));
                    } else {
                        if (dragHandle.includes("L") && Math.abs(startCrop.x + dx) < snapThresh) dx = -startCrop.x;
                        if (dragHandle.includes("R") && Math.abs(startCrop.x + startCrop.w + dx - origW) < snapThresh) dx = origW - (startCrop.x + startCrop.w);
                    }
                }
                if (dragHandle.includes("T") || dragHandle.includes("B")) {
                    const edgeY = dragHandle.includes("T") ? (startCrop.y + dy) : (startCrop.y + startCrop.h + dy);
                    let xStart = startCrop.x;
                    let xEnd = startCrop.x + startCrop.w;
                    if (dragHandle.includes("L")) xStart += dx;
                    if (dragHandle.includes("R")) xEnd += dx;
                    
                    const snappedY = findSmartSnapY(edgeY, xStart, xEnd, origImageData, searchRadius);
                    if (snappedY !== edgeY) {
                        dy = snappedY - (dragHandle.includes("T") ? startCrop.y : (startCrop.y + startCrop.h));
                    } else {
                        if (dragHandle.includes("T") && Math.abs(startCrop.y + dy) < snapThresh) dy = -startCrop.y;
                        if (dragHandle.includes("B") && Math.abs(startCrop.y + startCrop.h + dy - origH) < snapThresh) dy = origH - (startCrop.y + startCrop.h);
                    }
                }
            } else {
                if (dragHandle.includes("L") && Math.abs(startCrop.x + dx) < snapThresh) dx = -startCrop.x;
                if (dragHandle.includes("R") && Math.abs(startCrop.x + startCrop.w + dx - origW) < snapThresh) dx = origW - (startCrop.x + startCrop.w);
                if (dragHandle.includes("T") && Math.abs(startCrop.y + dy) < snapThresh) dy = -startCrop.y;
                if (dragHandle.includes("B") && Math.abs(startCrop.y + startCrop.h + dy - origH) < snapThresh) dy = origH - (startCrop.y + startCrop.h);
            }

            let altActive = e.altKey;
            let shiftActive = e.shiftKey;
            let locked = isLocked || shiftActive;
            let currentLockRatio = isLocked ? lockRatio : (startCrop.w / startCrop.h);

            let cx = startCrop.x + startCrop.w / 2;
            let cy = startCrop.y + startCrop.h / 2;

            let nw = startCrop.w, nh = startCrop.h;

            if (altActive) {
                if (dragHandle.includes("R")) nw += dx * 2;
                if (dragHandle.includes("L")) nw -= dx * 2;
                if (dragHandle.includes("B")) nh += dy * 2;
                if (dragHandle.includes("T")) nh -= dy * 2;
            } else {
                if (dragHandle.includes("R")) nw += dx;
                if (dragHandle.includes("L")) nw -= dx;
                if (dragHandle.includes("B")) nh += dy;
                if (dragHandle.includes("T")) nh -= dy;
            }

            if (locked) {
                if (dragHandle === "R" || dragHandle === "L") {
                    nh = nw / currentLockRatio;
                } else if (dragHandle === "B" || dragHandle === "T") {
                    nw = nh * currentLockRatio;
                } else {
                    if (Math.abs(dx) > Math.abs(dy)) { nh = nw / currentLockRatio; } else { nw = nh * currentLockRatio; }
                }
            }

            if (currentSnap > 1) {
                nw = Math.round(nw / currentSnap) * currentSnap;
                nh = Math.round(nh / currentSnap) * currentSnap;
            }

            let nx = startCrop.x, ny = startCrop.y;

            if (altActive) {
                nx = cx - nw / 2;
                ny = cy - nh / 2;
            } else {
                if (dragHandle.includes("L")) nx = startCrop.x + (startCrop.w - nw);
                if (dragHandle.includes("T")) ny = startCrop.y + (startCrop.h - nh);
                if (dragHandle === "R" || dragHandle === "L") {
                    if (locked) ny = cy - nh / 2; 
                }
                if (dragHandle === "T" || dragHandle === "B") {
                    if (locked) nx = cx - nw / 2;
                }
            }
            
            cropData.x = nx; cropData.y = ny; cropData.w = Math.max(1, nw); cropData.h = Math.max(1, nh);
        }
        requestDraw();
    });

    const onMouseUp = () => { isDragging = false; isPanning = false; dragHandle = null; };
    const onResize = () => { resizeCanvas(); };
    window.addEventListener("mouseup", onMouseUp, { signal: abortCtrl.signal });
    window.addEventListener("resize", onResize, { signal: abortCtrl.signal });

    setTimeout(() => {
        if (origImgObj.complete) { resizeCanvas(); } 
        else { origImgObj.onload = resizeCanvas; }
    }, 10);
}
