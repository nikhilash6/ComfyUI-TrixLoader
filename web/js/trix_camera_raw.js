import { app } from '../../../scripts/app.js';

const svgUndoCR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; width: 14px; height: 14px;"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>`;
const svgRedoCR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; width: 14px; height: 14px;"><polyline points="15 14 20 9 15 4"></polyline><path d="M4 20v-7a4 4 0 0 1 4-4h12"></path></svg>`;
const svgEyeCR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; width: 14px; height: 14px; margin-right: 4px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
const svgChevronDown = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s;"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
const svgFinger = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M10 13a4 4 0 0 0 7.42 2.72l2.3-2.3a1.42 1.42 0 0 0-2-2l-2.3 2.3"></path><path d="M14 13.5v-7a2 2 0 0 0-4 0v7"></path><path d="M10 13.5v-3a2 2 0 0 0-4 0v4.5"></path><path d="M6 15v-1a2 2 0 0 0-4 0v5a6 6 0 0 0 6 6h4a6 6 0 0 0 6-6v-3a2 2 0 0 0-4 0"></path></svg>`;
const svgResetHSL = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><polyline points="3 3 3 8 8 8"></polyline></svg>`;
const svgResetCR = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v6h6"></path><path d="M3 8a9 9 0 1 0 2.64-4.64L3 6"></path></svg>`;
const svgHQ = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"></rect><path d="M8 8h2.5v8H8zM13.5 8h2.3a3 3 0 0 1 0 6h-2.3zM13.5 14h2.6l1.6 2"></path></svg>`;
const svgRecenterCR = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"></circle><line x1="12" y1="1.5" x2="12" y2="5"></line><line x1="12" y1="19" x2="12" y2="22.5"></line><line x1="1.5" y1="12" x2="5" y2="12"></line><line x1="19" y1="12" x2="22.5" y2="12"></line></svg>`;
const svgCurve = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c4 0 4-10 9-10 3.5 0 3.5 6 9 6"></path><path d="M3 21h18"></path></svg>`;

const HSL_SATURATION_MULTIPLIER = 5;
const HSL_SATURATION_LOG = Math.log(1 + HSL_SATURATION_MULTIPLIER);

function createDefaultCurveState() {
    return {
        activeChannel: "rgb",
        rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        r: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        g: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        b: [{ x: 0, y: 0 }, { x: 255, y: 255 }]
    };
}

function cloneCurveState(curveState) {
    return JSON.parse(JSON.stringify(curveState));
}

function normalizeCurvePoints(points) {
    const fallback = [{ x: 0, y: 0 }, { x: 255, y: 255 }];
    if (!Array.isArray(points)) return fallback;

    const parsed = [];
    for (const pt of points) {
        if (!pt || typeof pt !== "object") continue;
        const x = Number.isFinite(pt.x) ? pt.x : parseFloat(pt.x);
        const y = Number.isFinite(pt.y) ? pt.y : parseFloat(pt.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        parsed.push({
            x: Math.max(0, Math.min(255, x)),
            y: Math.max(0, Math.min(255, y))
        });
    }

    if (parsed.length < 2) return fallback;
    parsed.sort((a, b) => a.x - b.x);

    const dedup = [];
    for (const p of parsed) {
        if (dedup.length > 0 && Math.abs(dedup[dedup.length - 1].x - p.x) < 0.01) dedup[dedup.length - 1] = p;
        else dedup.push(p);
    }

    if (dedup.length < 2) return fallback;
    if (dedup[0].x > 0) dedup.unshift({ x: 0, y: dedup[0].y });
    if (dedup[dedup.length - 1].x < 255) dedup.push({ x: 255, y: dedup[dedup.length - 1].y });
    return dedup;
}

function ensureCurveState(state) {
    const def = createDefaultCurveState();
    const out = { ...def, ...(state || {}) };
    out.activeChannel = ["rgb", "r", "g", "b"].includes(out.activeChannel) ? out.activeChannel : "rgb";
    out.rgb = normalizeCurvePoints(out.rgb);
    out.r = normalizeCurvePoints(out.r);
    out.g = normalizeCurvePoints(out.g);
    out.b = normalizeCurvePoints(out.b);
    return out;
}

function curveHasAdjustments(curveState) {
    const normalized = ensureCurveState(curveState);
    const isDefault = (arr) => arr.length === 2 && arr[0].x === 0 && arr[0].y === 0 && arr[1].x === 255 && arr[1].y === 255;
    return !(isDefault(normalized.rgb) && isDefault(normalized.r) && isDefault(normalized.g) && isDefault(normalized.b));
}

function buildCurveLut(points) {
    const pts = normalizeCurvePoints(points);
    const lut = new Uint8Array(256);
    let seg = 0;
    for (let x = 0; x <= 255; x++) {
        while (seg < pts.length - 2 && x > pts[seg + 1].x) seg++;
        const p0 = pts[seg];
        const p1 = pts[Math.min(seg + 1, pts.length - 1)];
        const dx = (p1.x - p0.x) || 1;
        const t = Math.max(0, Math.min(1, (x - p0.x) / dx));
        const y = p0.y + (p1.y - p0.y) * t;
        lut[x] = Math.max(0, Math.min(255, Math.round(y)));
    }
    return lut;
}

function applyLightnessLikePhotoshop(lightness, delta) {
    const d = Math.max(-1, Math.min(1, delta));
    if (d >= 0) return Math.max(0, Math.min(1, lightness + (1 - lightness) * d));
    return Math.max(0, Math.min(1, lightness + lightness * d));
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; } 
    else {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h * 360, s, l];
}

function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) { r = g = b = l; } 
    else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        h /= 360;
        let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        let p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return [r * 255, g * 255, b * 255];
}

export function openTrixCameraRawEditor(node) {
    const abortCtrl = new AbortController();
    if (!node.imgTagRef || !node.imgTagRef.naturalWidth) {
        alert("Please load an image first!");
        return;
    }

    const origImgObj = new Image();
    origImgObj.crossOrigin = "Anonymous";
    origImgObj.src = node.imgTagRef.src;

    const TRIX_AIO_SUBFOLDER = "aio_input";
    const trixCropSafeId = (value) => String(value ?? "node").replace(/[^a-zA-Z0-9_-]+/g, "_") || "node";
    const trixCropFilename = (nodeId) => `trix_edited_${trixCropSafeId(nodeId)}.png`;

    const getW = (name) => node.widgets ? node.widgets.find(w => w && w.name === name) : null;
    const getV = (name) => { const w = getW(name); return w ? parseInt(w.value) || 0 : 0; };

    let state = {
        cr_exp: getV('cr_exp'), cr_cont: getV('cr_cont'), cr_high: getV('cr_high'), cr_shad: getV('cr_shad'),
        cr_white: getV('cr_white'), cr_black: getV('cr_black'), cr_temp: getV('cr_temp'), cr_tint: getV('cr_tint'),
        cr_colorfulness: getV('cr_colorfulness'), cr_sat: getV('cr_sat'), cr_tex: getV('cr_tex'), cr_clar: getV('cr_clar'),
        cr_dehz: getV('cr_dehz'), cr_grain: getV('cr_grain'), cr_sharp: getV('cr_sharp'), cr_blur: getV('cr_blur'), cr_vignette: getV('cr_vignette')
    };

    let hslState = {
        colorize: false,
        activeChannel: 'master', 
        master:   { h: 0, s: 0, l: 0 },
        reds:     { h: 0, s: 0, l: 0, center: 0, width: 60 },
        yellows:  { h: 0, s: 0, l: 0, center: 60, width: 60 },
        greens:   { h: 0, s: 0, l: 0, center: 120, width: 60 },
        cyans:    { h: 0, s: 0, l: 0, center: 180, width: 60 },
        blues:    { h: 0, s: 0, l: 0, center: 240, width: 60 },
        magentas: { h: 0, s: 0, l: 0, center: 300, width: 60 }
    };
    let curvesState = createDefaultCurveState();

    const wHslData = getW("hsl_data");
    if (wHslData && wHslData.value && wHslData.value !== "{}") {
        try {
            const parsed = JSON.parse(wHslData.value);
            hslState = { ...hslState, ...parsed };
        } catch(e) {}
    }
    const wCurveData = getW("curve_data");
    if (wCurveData && wCurveData.value && wCurveData.value !== "{}") {
        try {
            curvesState = ensureCurveState(JSON.parse(wCurveData.value));
        } catch(e) {}
    }

    let crHistory = [ JSON.stringify({ state, hslState, curvesState }) ];
    let crHistoryIdx = 0;

    const overlay = document.createElement("div");
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background-color: #1a1a1a;
        z-index: 10000; display: flex; flex-direction: row; font-family: sans-serif; user-select: none;
    `;
    overlay.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const workspace = document.createElement("div");
    workspace.style.cssText = `
        flex: 1; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center;
        background-image: linear-gradient(45deg, #222 25%, transparent 25%, transparent 75%, #222 75%, #222),
                          linear-gradient(45deg, #222 25%, transparent 25%, transparent 75%, #222 75%, #222);
        background-size: 16px 16px; background-position: 0 0, 8px 8px;
    `;

    const sidebar = document.createElement("div");
    sidebar.style.cssText = `
        width: min(340px, 42vw); min-width: 280px; height: 100%; max-height: 100vh; background: #151515; border-left: 1px solid #333;
        display: block; padding: 18px 18px 34px 18px; box-sizing: border-box;
        box-shadow: -2px 0 10px rgba(0,0,0,0.5); z-index: 10; overflow-y: auto; overflow-x: hidden;
        min-height: 0; scrollbar-gutter: stable; overscroll-behavior: contain;
    `;

    if (!document.getElementById("trix-cr-inputs")) {
        const style = document.createElement("style");
        style.id = "trix-cr-inputs";
        style.innerHTML = `
            .trix-cr-panel::-webkit-scrollbar { width: 6px; }
            .trix-cr-panel::-webkit-scrollbar-track { background: transparent; }
            .trix-cr-panel::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }
            .trix-cr-panel::-webkit-scrollbar-thumb:hover { background: #666; }
        `;
        document.head.appendChild(style);
    }
    sidebar.className = "trix-cr-panel";
    sidebar.addEventListener("wheel", (e) => {
        const maxScroll = sidebar.scrollHeight - sidebar.clientHeight;
        if (maxScroll <= 0) return;
        e.stopPropagation();
        if (e.target && e.target.tagName === "INPUT" && e.target.type === "range") {
            e.preventDefault();
            sidebar.scrollTop += e.deltaY;
        }
    }, { passive: false, signal: abortCtrl.signal });

    const revealSidebarSection = (element) => {
        requestAnimationFrame(() => {
            if (!element || !document.body.contains(element)) return;
            element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
        });
    };

    const title = document.createElement("div");
    title.innerHTML = `Camera Raw / Hue-Saturation / Curves`;
    title.style.cssText = "color: #fff; font-size: 16px; font-weight: bold; margin-bottom: 15px;";
    sidebar.appendChild(title);

    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.transformOrigin = "0 0";
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    workspace.appendChild(canvas);
    
    let camera = { x: 0, y: 0, zoom: 1 };
    let isPanning = false; let startMx = 0; let startMy = 0;
    let isFirstLaunch = true;
    let lastWorkspaceW = workspace.clientWidth || 0;
    let lastWorkspaceH = workspace.clientHeight || 0;
    
    let hslFingerActive = false;
    let hslDragging = false;
    let dragStartTargetX = 0;
    let dragStartSat = 0;

    let renderTimer = null;
    let baseImgData = null;
    let pW = 0, pH = 0;

    const getFitScale = () => {
        if (!pW || !pH) return 1.0;
        const fitZoomW = (workspace.clientWidth * 0.9) / pW;
        const fitZoomH = (workspace.clientHeight * 0.9) / pH;
        return Math.min(fitZoomW, fitZoomH, 1.0);
    };

    const updateRecenterBtnText = () => {
        const span = recenterBtn.querySelector("span");
        if (span) {
            const fitScale = getFitScale();
            const pct = Math.round((camera.zoom / fitScale) * 100);
            span.innerText = `Recenter (${pct}%)`;
        }
    };

    const drawWorkspace = () => {
        workspace.style.backgroundPosition = `${camera.x}px ${camera.y}px, ${camera.x + 8}px ${camera.y + 8}px`;
        canvas.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
        if (typeof updateRecenterBtnText === "function") {
            updateRecenterBtnText();
        }
    };

    const topActions = document.createElement("div");
    topActions.style.cssText = "display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px;";
    const makeActionBtn = (iconSvg, text) => {
        const btn = document.createElement("button");
        btn.innerHTML = `${iconSvg} <span>${text}</span>`;
        btn.style.cssText = "display: flex; align-items: center; justify-content: center; gap: 5px; background: #24242a; color: #cfcfcf; border: 1px solid #444; border-radius: 4px; padding: 5px 6px; cursor: pointer; font-size: 10px; transition: 0.15s; font-weight: 600; line-height: 1;";
        btn.onmouseenter = () => {
            if (!btn.dataset.active) {
                btn.style.background = "#333a45";
                btn.style.color = "#fff";
            }
        };
        btn.onmouseleave = () => {
            if (!btn.dataset.active) {
                btn.style.background = "#24242a";
                btn.style.color = "#cfcfcf";
            }
        };
        return btn;
    };

    const quickActionsGrid = document.createElement("div");
    quickActionsGrid.style.cssText = "display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px;";

    const resetCrBtn = makeActionBtn(svgResetCR, "Reset");
    resetCrBtn.onmouseenter = () => { if (!resetCrBtn.dataset.active) { resetCrBtn.style.background = "#d44a4a"; resetCrBtn.style.color = "#fff"; } };
    resetCrBtn.onmouseleave = () => { if (!resetCrBtn.dataset.active) { resetCrBtn.style.background = "#24242a"; resetCrBtn.style.color = "#cfcfcf"; } };

    let useFullRes = false;
    const hqBtn = makeActionBtn(svgHQ, "HQ Preview");
    hqBtn.onclick = () => {
        useFullRes = !useFullRes;
        if (useFullRes) {
            hqBtn.dataset.active = "1";
            hqBtn.style.background = "rgb(246, 103, 68)";
            hqBtn.style.color = "#fff";
        } else {
            delete hqBtn.dataset.active;
            hqBtn.style.background = "#24242a";
            hqBtn.style.color = "#cfcfcf";
        }
        initCanvas(); 
    };

    const recenterBtn = makeActionBtn(svgRecenterCR, "Recenter");
    recenterBtn.onmouseenter = () => { if (!recenterBtn.dataset.active) { recenterBtn.style.background = "#333a45"; recenterBtn.style.color = "#fff"; } };
    recenterBtn.onmouseleave = () => { if (!recenterBtn.dataset.active) { recenterBtn.style.background = "#24242a"; recenterBtn.style.color = "#cfcfcf"; } };

    const centerImage = (forceFit = false) => {
        if (!pW || !pH) return;
        camera.zoom = getFitScale();
        camera.x = workspace.clientWidth / 2 - (pW / 2) * camera.zoom;
        camera.y = workspace.clientHeight / 2 - (pH / 2) * camera.zoom;
        drawWorkspace();
    };
    recenterBtn.onclick = () => centerImage(true);

    const undoBtn = document.createElement("button");
    undoBtn.innerHTML = svgUndoCR;
    undoBtn.title = "Undo";
    undoBtn.style.cssText = "background: #24242a; color: #ccc; border: 1px solid #444; border-radius: 4px; padding: 6px; cursor: pointer; flex: 1; transition: 0.2s;";
    undoBtn.onmouseenter = () => { undoBtn.style.background = "#33789a"; undoBtn.style.color = "#fff"; };
    undoBtn.onmouseleave = () => { undoBtn.style.background = "#24242a"; undoBtn.style.color = "#ccc"; };

    const redoBtn = document.createElement("button");
    redoBtn.innerHTML = svgRedoCR;
    redoBtn.title = "Redo";
    redoBtn.style.cssText = "background: #24242a; color: #ccc; border: 1px solid #444; border-radius: 4px; padding: 6px; cursor: pointer; flex: 1; transition: 0.2s;";
    redoBtn.onmouseenter = () => { redoBtn.style.background = "#33789a"; redoBtn.style.color = "#fff"; };
    redoBtn.onmouseleave = () => { redoBtn.style.background = "#24242a"; redoBtn.style.color = "#ccc"; };

    const compareBtn = makeActionBtn(svgEyeCR, "Compare");
    
    let isComparing = false;
    const startCompare = () => {
        if (!isComparing) {
            isComparing = true;
            compareBtn.dataset.active = "1";
            compareBtn.style.background = "rgb(246, 103, 68)";
            compareBtn.style.color = "#fff";
            renderPixels(true);
        }
    };
    const stopCompare = () => {
        if (isComparing) {
            isComparing = false;
            delete compareBtn.dataset.active;
            compareBtn.style.background = "#24242a";
            compareBtn.style.color = "#cfcfcf";
            scheduleRender();
        }
    };
    
    compareBtn.onmousedown = startCompare; 
    compareBtn.onmouseup = stopCompare; 
    compareBtn.onmouseleave = () => {
        stopCompare();
        if (!isComparing) {
            compareBtn.style.background = "#24242a";
            compareBtn.style.color = "#cfcfcf";
        }
    };

    quickActionsGrid.append(resetCrBtn, hqBtn, recenterBtn, compareBtn);

    const row3 = document.createElement("div");
    row3.style.cssText = "display: flex; gap: 6px;";
    row3.append(undoBtn, redoBtn);

    topActions.append(quickActionsGrid, row3);
    sidebar.appendChild(topActions);

    const updateHistoryBtns = () => {
        undoBtn.style.opacity = crHistoryIdx > 0 ? "1" : "0.3";
        undoBtn.style.pointerEvents = crHistoryIdx > 0 ? "auto" : "none";
        redoBtn.style.opacity = crHistoryIdx < crHistory.length - 1 ? "1" : "0.3";
        redoBtn.style.pointerEvents = crHistoryIdx < crHistory.length - 1 ? "auto" : "none";
    };

    const pushCrHistory = () => {
        const currentStateStr = JSON.stringify({ state, hslState, curvesState });
        if (crHistory[crHistoryIdx] === currentStateStr) return; 
        crHistory = crHistory.slice(0, crHistoryIdx + 1);
        crHistory.push(currentStateStr);
        if (crHistory.length > 30) crHistory.shift(); 
        crHistoryIdx = crHistory.length - 1;
        updateHistoryBtns();
    };

    const applyHistoryState = (idx) => {
        if (idx < 0 || idx >= crHistory.length) return;
        crHistoryIdx = idx;
        const saved = JSON.parse(crHistory[crHistoryIdx]);
        state = saved.state || state;
        hslState = saved.hslState || hslState;
        curvesState = ensureCurveState(saved.curvesState || curvesState);
        
        for (const key in state) {
            const iEl = document.getElementById(`cr_input_${key}`);
            const sEl = document.getElementById(`cr_slider_${key}`);
            if (iEl) iEl.value = state[key];
            if (sEl) sEl.value = state[key];
        }
        updateHslUI();
        updateCurvesUI();
        updateHistoryBtns();
        scheduleRender();
    };

    undoBtn.onclick = () => applyHistoryState(crHistoryIdx - 1);
    redoBtn.onclick = () => applyHistoryState(crHistoryIdx + 1);
    updateHistoryBtns();

    const rawGroupsJS = [
        [
            {id: 'cr_exp', label: 'Exposure', min:-150, max:150},
            {id: 'cr_cont', label: 'Contrast', min:-150, max:150},
            {id: 'cr_high', label: 'Highlights', min:-150, max:150},
            {id: 'cr_shad', label: 'Shadows', min:-150, max:150},
            {id: 'cr_white', label: 'Whites', min:-150, max:150},
            {id: 'cr_black', label: 'Blacks', min:-150, max:150}
        ],
        [
            {id: 'cr_temp', label: 'Temperature', min:-150, max:150},
            {id: 'cr_tint', label: 'Tint', min:-150, max:150},
            {id: 'cr_colorfulness', label: 'Colorfulness', min:-150, max:150},
            {id: 'cr_sat', label: 'Saturation', min:-100, max:100}
        ],
        [
            {id: 'cr_tex', label: 'Texture', min:-150, max:150},
            {id: 'cr_clar', label: 'Clarity', min:-150, max:150},
            {id: 'cr_dehz', label: 'Dehaze', min:-150, max:150},
            {id: 'cr_grain', label: 'Grain', min:0, max:150}
        ],
        [
            {id: 'cr_sharp', label: 'Sharpening', min:0, max:150},
            {id: 'cr_blur', label: 'Gaussian Blur', min:0, max:150},
            {id: 'cr_vignette', label: 'Vignette', min:0, max:150}
        ]
    ];

    rawGroupsJS.forEach((group, gIdx) => {
        if (gIdx > 0) {
            const sep = document.createElement("hr");
            sep.style.cssText = "border: none; border-top: 1px solid #333; margin: 6px 0; width: 100%;";
            sidebar.appendChild(sep);
        }
        group.forEach(conf => {
            const row = document.createElement("div");
            row.style.cssText = "display: flex; flex-direction: row; align-items: center; justify-content: space-between; padding: 4px; margin-bottom: 2px; border-radius: 4px; flex-shrink: 0; min-height: 20px; transition: 0.1s;";
            row.onmouseenter = () => { row.style.background = "#222"; };
            row.onmouseleave = () => { row.style.background = "transparent"; };

            const tSpan = document.createElement("span");
            tSpan.innerText = conf.label;
            tSpan.style.cssText = "color: #bbb; font-family: var(--comfy-font-family, sans-serif); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 0 0 80px; cursor: pointer;";
            
            const sEl = document.createElement("input");
            sEl.id = `cr_slider_${conf.id}`;
            sEl.type = "range"; sEl.min = conf.min; sEl.max = conf.max; sEl.value = state[conf.id];
            sEl.style.cssText = "flex: 1; margin: 0 8px; min-width: 30px; cursor: pointer; height: 10px; accent-color: #33789a;";
            
            const iEl = document.createElement("input");
            iEl.id = `cr_input_${conf.id}`;
            iEl.type = "number"; iEl.min = conf.min; iEl.max = conf.max; iEl.value = state[conf.id];
            iEl.className = "trix-num";
            iEl.style.cssText = "background: #000; color: #fff; border: 1px solid #444; padding: 2px 4px; border-radius: 3px; font-size: 11px; font-family: var(--comfy-font-family, monospace); outline: none; width: 40px; box-sizing: border-box; cursor: pointer; text-align: center; flex-shrink: 0;";
            
            const updateVals = (val) => {
                let parsed = parseInt(val);
                if(isNaN(parsed)) parsed = 0;
                parsed = Math.max(conf.min, Math.min(conf.max, parsed));
                iEl.value = parsed; sEl.value = parsed;
                state[conf.id] = parsed;
                scheduleRender();
            };

            iEl.onchange = (e) => { updateVals(e.target.value); pushCrHistory(); };
            sEl.oninput = (e) => updateVals(e.target.value);
            sEl.onchange = () => pushCrHistory();

            const doReset = () => { updateVals(0); pushCrHistory(); };
            sEl.ondblclick = doReset;
            tSpan.ondblclick = doReset;

            row.append(tSpan, sEl, iEl);
            sidebar.appendChild(row);
        });
    });

    // --- HUE/SATURATION PANEL ---
    const sep = document.createElement("hr");
    sep.style.cssText = "border: none; border-top: 1px solid #333; margin: 10px 0; width: 100%;";
    sidebar.appendChild(sep);

    const hslWrapper = document.createElement("div");
    hslWrapper.style.cssText = "border: 1px solid #444; border-radius: 4px; background: #1a1a1a; overflow: visible; margin-bottom: 12px;";

    const hslHeader = document.createElement("div");
    hslHeader.style.cssText = "padding: 8px 12px; background: #2a2a2f; cursor: pointer; display: flex; justify-content: space-between; align-items: center; color: #fff; font-size: 12px; font-weight: bold; user-select: none;";
    hslHeader.innerHTML = `<span>Hue/Saturation</span> <span id="hsl_chev">${svgChevronDown}</span>`;
    
    const hslBody = document.createElement("div");
    hslBody.style.cssText = "padding: 12px; display: none; flex-direction: column; gap: 12px; overflow: visible;";
    
    let isHslOpen = false;
    hslHeader.onclick = () => {
        isHslOpen = !isHslOpen;
        hslBody.style.display = isHslOpen ? "flex" : "none";
        document.getElementById("hsl_chev").style.transform = isHslOpen ? "rotate(-180deg)" : "rotate(0deg)";
        if (isHslOpen) revealSidebarSection(hslWrapper);
    };

    const topHslRow = document.createElement("div");
    topHslRow.style.cssText = "display: flex; align-items: center; gap: 8px;";

    const fingerBtn = document.createElement("button");
    fingerBtn.innerHTML = svgFinger;
    fingerBtn.title = "Drag in image to modify saturation";
    fingerBtn.style.cssText = "background: #222; color: #aaa; border: 1px solid #444; border-radius: 4px; padding: 4px; cursor: pointer; transition: 0.2s;";
    fingerBtn.onclick = () => {
        hslFingerActive = !hslFingerActive;
        fingerBtn.style.background = hslFingerActive ? "rgb(246, 103, 68)" : "#222";
        fingerBtn.style.color = hslFingerActive ? "#fff" : "#aaa";
    };

    const channelSelect = document.createElement("select");
    channelSelect.style.cssText = "flex: 1; background: #111; color: #fff; border: 1px solid #444; padding: 4px; border-radius: 4px; font-size: 11px; outline: none; cursor: pointer;";
    const channels = [
        {val: 'master', text: 'Master'}, {val: 'reds', text: 'Reds'}, {val: 'yellows', text: 'Yellows'},
        {val: 'greens', text: 'Greens'}, {val: 'cyans', text: 'Cyans'}, {val: 'blues', text: 'Blues'}, {val: 'magentas', text: 'Magentas'}
    ];
    channels.forEach(ch => {
        const opt = document.createElement("option"); opt.value = ch.val; opt.innerText = ch.text; channelSelect.appendChild(opt);
    });
    
    const resetHslBtn = document.createElement("button");
    resetHslBtn.innerHTML = svgResetHSL;
    resetHslBtn.title = "Reset Channel";
    resetHslBtn.style.cssText = "background: none; border: none; color: #aaa; cursor: pointer; padding: 2px;";
    resetHslBtn.onclick = () => {
        if(hslState.activeChannel === 'master') {
            hslState.master = {h:0, s:0, l:0};
        } else {
            const defCenters = {reds:0, yellows:60, greens:120, cyans:180, blues:240, magentas:300};
            hslState[hslState.activeChannel] = {h:0, s:0, l:0, center: defCenters[hslState.activeChannel], width: 60};
        }
        updateHslUI(); pushCrHistory(); scheduleRender();
    };

    topHslRow.append(fingerBtn, channelSelect, resetHslBtn);
    hslBody.appendChild(topHslRow);

    const createHslSlider = (id, label, min, max, val) => {
        const row = document.createElement("div");
        row.style.cssText = "display: flex; align-items: center; justify-content: space-between;";
        const t = document.createElement("span"); t.innerText = label; t.style.cssText = "color: #bbb; font-size: 11px; flex: 0 0 65px;";
        const s = document.createElement("input"); s.type = "range"; s.min = min; s.max = max; s.value = val;
        s.style.cssText = "flex: 1; margin: 0 8px; accent-color: #33789a;";
        const i = document.createElement("input"); i.type = "number"; i.min = min; i.max = max; i.value = val;
        i.className = "trix-num";
        i.style.cssText = "width: 40px; background: #000; color: #fff; border: 1px solid #444; border-radius: 3px; font-size: 11px; text-align: center;";
        
        const update = (v) => {
            let parsed = parseInt(v) || 0;
            parsed = Math.max(min, Math.min(max, parsed));
            s.value = parsed; i.value = parsed;
            hslState[hslState.activeChannel][id] = parsed;
            updateGradientBars();
            scheduleRender();
        };
        s.oninput = (e) => update(e.target.value);
        s.onchange = () => pushCrHistory();
        i.onchange = (e) => { update(e.target.value); pushCrHistory(); };

        const reset = () => {
            if (id === "width" && hslState.activeChannel !== "master") {
                hslState[hslState.activeChannel].width = 60;
            } else if (id !== "width") {
                hslState[hslState.activeChannel][id] = 0;
            }
            updateHslUI();
            pushCrHistory();
            scheduleRender();
        };
        s.ondblclick = (e) => { e.preventDefault(); reset(); };
        i.ondblclick = (e) => { e.preventDefault(); reset(); };
        t.ondblclick = (e) => { e.preventDefault(); reset(); };
        
        row.append(t, s, i);
        return { row, s, i };
    };

    const sHue = createHslSlider('h', 'Hue:', -180, 180, 0);
    const sSat = createHslSlider('s', 'Saturation:', -100, 100, 0);
    const sLgt = createHslSlider('l', 'Lightness:', -100, 100, 0);
    hslBody.append(sHue.row, sSat.row, sLgt.row);

    const colorizeRow = document.createElement("div");
    colorizeRow.style.cssText = "display: flex; align-items: center; gap: 6px; font-size: 11px; color: #ccc;";
    const colorizeChk = document.createElement("input"); colorizeChk.type = "checkbox"; colorizeChk.style.cursor = "pointer";
    colorizeRow.append(colorizeChk, document.createTextNode("Colorize"));
    colorizeChk.onchange = (e) => {
        hslState.colorize = e.target.checked;
        pushCrHistory();
        scheduleRender();
    };
    hslBody.appendChild(colorizeRow);

    const gradContainer = document.createElement("div");
    gradContainer.style.cssText = "display: flex; flex-direction: column; gap: 4px; margin-top: 5px;";
    
    const gradBase = document.createElement("div");
    gradBase.style.cssText = "height: 8px; width: 100%; background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); border-radius: 2px;";
    
    const gradShift = document.createElement("div");
    gradShift.style.cssText = "height: 8px; width: 100%; background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); border-radius: 2px;";
    
    gradContainer.append(gradBase, gradShift);
    hslBody.appendChild(gradContainer);

    const sWidth = createHslSlider('width', 'Spread:', 10, 220, 60);
    sWidth.row.style.marginTop = "8px";
    hslBody.appendChild(sWidth.row);

    hslBody.addEventListener("wheel", (e) => {
        if (e.target && e.target.tagName === "INPUT" && e.target.type === "range") {
            e.preventDefault();
            sidebar.scrollTop += e.deltaY;
        }
    }, { passive: false, signal: abortCtrl.signal });

    hslWrapper.append(hslHeader, hslBody);
    sidebar.appendChild(hslWrapper);

    const updateGradientBars = () => {
        let shift = hslState[hslState.activeChannel].h || 0;
        let c = [];
        for (let i = 0; i <= 6; i++) {
            let hue = (i * 60 + shift) % 360;
            if (hue < 0) hue += 360;
            c.push(`hsl(${hue}, 100%, 50%)`);
        }
        gradShift.style.background = `linear-gradient(to right, ${c.join(', ')})`;
    };

    const updateHslUI = () => {
        channelSelect.value = hslState.activeChannel;
        colorizeChk.checked = hslState.colorize;
        sHue.s.value = hslState[hslState.activeChannel].h; sHue.i.value = hslState[hslState.activeChannel].h;
        sSat.s.value = hslState[hslState.activeChannel].s; sSat.i.value = hslState[hslState.activeChannel].s;
        sLgt.s.value = hslState[hslState.activeChannel].l; sLgt.i.value = hslState[hslState.activeChannel].l;
        
        if (hslState.activeChannel === 'master') {
            sWidth.row.style.display = 'none';
        } else {
            sWidth.row.style.display = 'flex';
            sWidth.s.value = hslState[hslState.activeChannel].width;
            sWidth.i.value = hslState[hslState.activeChannel].width;
        }

        fingerBtn.style.background = hslFingerActive ? "rgb(246, 103, 68)" : "#222";
        fingerBtn.style.color = hslFingerActive ? "#fff" : "#aaa";
        updateGradientBars();
    };

    channelSelect.onchange = (e) => {
        hslState.activeChannel = e.target.value;
        updateHslUI();
    };

    // --- END HUE/SATURATION PANEL ---

    // --- CURVES PANEL ---
    const curvesWrapper = document.createElement("div");
    curvesWrapper.style.cssText = "border: 1px solid #444; border-radius: 4px; background: #1a1a1a; overflow: hidden; margin-bottom: 14px;";

    const curvesHeader = document.createElement("div");
    curvesHeader.style.cssText = "padding: 8px 12px; background: #2a2a2f; cursor: pointer; display: flex; justify-content: space-between; align-items: center; color: #fff; font-size: 12px; font-weight: bold; user-select: none;";
    curvesHeader.innerHTML = `<span>${svgCurve} Curves</span> <span id="curve_chev">${svgChevronDown}</span>`;

    const curvesBody = document.createElement("div");
    curvesBody.style.cssText = "padding: 10px; display: none; flex-direction: column; gap: 8px;";
    let isCurvesOpen = false;
    curvesHeader.onclick = () => {
        isCurvesOpen = !isCurvesOpen;
        curvesBody.style.display = isCurvesOpen ? "flex" : "none";
        document.getElementById("curve_chev").style.transform = isCurvesOpen ? "rotate(-180deg)" : "rotate(0deg)";
        if (isCurvesOpen) revealSidebarSection(curvesWrapper);
    };

    const curveTopRow = document.createElement("div");
    curveTopRow.style.cssText = "display: flex; gap: 6px; align-items: center;";
    const curveChannelSelect = document.createElement("select");
    curveChannelSelect.style.cssText = "flex: 1; background: #111; color: #fff; border: 1px solid #444; padding: 4px; border-radius: 4px; font-size: 11px;";
    [
        { v: "rgb", t: "RGB" },
        { v: "r", t: "Red" },
        { v: "g", t: "Green" },
        { v: "b", t: "Blue" }
    ].forEach((optData) => {
        const opt = document.createElement("option");
        opt.value = optData.v;
        opt.textContent = optData.t;
        curveChannelSelect.appendChild(opt);
    });

    const resetCurveBtn = document.createElement("button");
    resetCurveBtn.innerHTML = svgResetCR;
    resetCurveBtn.title = "Reset Curve Channel";
    resetCurveBtn.style.cssText = "background: none; border: none; color: #aaa; cursor: pointer; padding: 2px 4px;";

    curveTopRow.append(curveChannelSelect, resetCurveBtn);
    curvesBody.appendChild(curveTopRow);

    const curvesCanvas = document.createElement("canvas");
    curvesCanvas.width = 256;
    curvesCanvas.height = 256;
    curvesCanvas.style.cssText = "width: min(100%, 280px); aspect-ratio: 1 / 1; height: auto; align-self: center; background: #0f0f13; border: 1px solid #2e2e33; border-radius: 4px; cursor: crosshair; image-rendering: auto; box-sizing: border-box;";
    curvesBody.appendChild(curvesCanvas);

    const curveHint = document.createElement("div");
    curveHint.textContent = "Click: add point, drag: move, right click: remove point, double click: reset channel.";
    curveHint.style.cssText = "color: #888; font-size: 10px; line-height: 1.3;";
    curvesBody.appendChild(curveHint);

    curvesWrapper.append(curvesHeader, curvesBody);
    sidebar.appendChild(curvesWrapper);

    const curvesCtx = curvesCanvas.getContext("2d");
    let activeCurvePointIdx = -1;
    let isCurveDragging = false;

    const getChannelColor = (ch) => {
        if (ch === "r") return "#ff6a6a";
        if (ch === "g") return "#67d967";
        if (ch === "b") return "#6ea6ff";
        return "#e5e5e5";
    };
    const getActiveCurvePoints = () => normalizeCurvePoints(curvesState[curvesState.activeChannel]);
    const setActiveCurvePoints = (points) => { curvesState[curvesState.activeChannel] = normalizeCurvePoints(points); };

    const canvasPosToCurve = (evt) => {
        const rect = curvesCanvas.getBoundingClientRect();
        const x = ((evt.clientX - rect.left) / rect.width) * 255;
        const y = (1 - (evt.clientY - rect.top) / rect.height) * 255;
        return {
            x: Math.max(0, Math.min(255, x)),
            y: Math.max(0, Math.min(255, y))
        };
    };
    const curveToCanvasPos = (pt) => {
        return {
            x: (pt.x / 255) * curvesCanvas.width,
            y: (1 - pt.y / 255) * curvesCanvas.height
        };
    };

    const findCurvePointIdx = (x, y, radius = 10) => {
        const points = getActiveCurvePoints();
        for (let i = 0; i < points.length; i++) {
            const pos = curveToCanvasPos(points[i]);
            const dx = x - pos.x;
            const dy = y - pos.y;
            if (Math.sqrt(dx * dx + dy * dy) <= radius) return i;
        }
        return -1;
    };

    const drawCurvesUI = () => {
        const w = curvesCanvas.width;
        const h = curvesCanvas.height;
        const points = getActiveCurvePoints();
        curvesCtx.clearRect(0, 0, w, h);

        curvesCtx.fillStyle = "#0f0f13";
        curvesCtx.fillRect(0, 0, w, h);

        curvesCtx.strokeStyle = "#27272d";
        curvesCtx.lineWidth = 1;
        for (let i = 1; i <= 7; i++) {
            const x = (w / 8) * i;
            const y = (h / 8) * i;
            curvesCtx.beginPath();
            curvesCtx.moveTo(x, 0);
            curvesCtx.lineTo(x, h);
            curvesCtx.stroke();
            curvesCtx.beginPath();
            curvesCtx.moveTo(0, y);
            curvesCtx.lineTo(w, y);
            curvesCtx.stroke();
        }

        curvesCtx.strokeStyle = "#51515e";
        curvesCtx.setLineDash([4, 4]);
        curvesCtx.beginPath();
        curvesCtx.moveTo(0, h);
        curvesCtx.lineTo(w, 0);
        curvesCtx.stroke();
        curvesCtx.setLineDash([]);

        curvesCtx.strokeStyle = getChannelColor(curvesState.activeChannel);
        curvesCtx.lineWidth = 2;
        curvesCtx.beginPath();
        points.forEach((pt, idx) => {
            const p = curveToCanvasPos(pt);
            if (idx === 0) curvesCtx.moveTo(p.x, p.y);
            else curvesCtx.lineTo(p.x, p.y);
        });
        curvesCtx.stroke();

        points.forEach((pt, idx) => {
            const p = curveToCanvasPos(pt);
            curvesCtx.fillStyle = idx === activeCurvePointIdx ? "#fff" : getChannelColor(curvesState.activeChannel);
            curvesCtx.strokeStyle = "#111";
            curvesCtx.lineWidth = 1.5;
            curvesCtx.beginPath();
            curvesCtx.arc(p.x, p.y, idx === activeCurvePointIdx ? 5 : 4, 0, Math.PI * 2);
            curvesCtx.fill();
            curvesCtx.stroke();
        });
    };

    const updateCurvesUI = () => {
        curvesState = ensureCurveState(curvesState);
        curveChannelSelect.value = curvesState.activeChannel;
        drawCurvesUI();
    };

    curveChannelSelect.onchange = (e) => {
        curvesState.activeChannel = e.target.value;
        updateCurvesUI();
    };

    resetCurveBtn.onclick = () => {
        curvesState[curvesState.activeChannel] = [{ x: 0, y: 0 }, { x: 255, y: 255 }];
        updateCurvesUI();
        pushCrHistory();
        scheduleRender();
    };

    curvesCanvas.oncontextmenu = (e) => {
        e.preventDefault();
        const rect = curvesCanvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * curvesCanvas.width;
        const y = ((e.clientY - rect.top) / rect.height) * curvesCanvas.height;
        const points = getActiveCurvePoints();
        const idx = findCurvePointIdx(x, y, 11);
        if (idx > 0 && idx < points.length - 1) {
            points.splice(idx, 1);
            setActiveCurvePoints(points);
            updateCurvesUI();
            pushCrHistory();
            scheduleRender();
        }
    };

    curvesCanvas.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        const rect = curvesCanvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * curvesCanvas.width;
        const y = ((e.clientY - rect.top) / rect.height) * curvesCanvas.height;
        const points = getActiveCurvePoints();
        const hit = findCurvePointIdx(x, y, 10);
        if (hit >= 0) {
            activeCurvePointIdx = hit;
            isCurveDragging = true;
            drawCurvesUI();
            return;
        }

        const curvePt = canvasPosToCurve(e);
        points.push({ x: curvePt.x, y: curvePt.y });
        points.sort((a, b) => a.x - b.x);
        setActiveCurvePoints(points);
        activeCurvePointIdx = points.findIndex((p) => Math.abs(p.x - curvePt.x) < 0.01 && Math.abs(p.y - curvePt.y) < 0.01);
        isCurveDragging = true;
        updateCurvesUI();
        scheduleRender();
    }, { signal: abortCtrl.signal });

    curvesCanvas.addEventListener("mousemove", (e) => {
        if (!isCurveDragging || activeCurvePointIdx < 0) return;
        const points = getActiveCurvePoints();
        if (activeCurvePointIdx >= points.length) return;
        const curvePt = canvasPosToCurve(e);

        if (activeCurvePointIdx === 0) {
            points[0].x = 0;
            points[0].y = curvePt.y;
        } else if (activeCurvePointIdx === points.length - 1) {
            points[activeCurvePointIdx].x = 255;
            points[activeCurvePointIdx].y = curvePt.y;
        } else {
            const prevX = points[activeCurvePointIdx - 1].x + 0.2;
            const nextX = points[activeCurvePointIdx + 1].x - 0.2;
            points[activeCurvePointIdx].x = Math.max(prevX, Math.min(nextX, curvePt.x));
            points[activeCurvePointIdx].y = curvePt.y;
        }

        setActiveCurvePoints(points);
        drawCurvesUI();
        scheduleRender();
    }, { signal: abortCtrl.signal });

    curvesCanvas.addEventListener("dblclick", (e) => {
        e.preventDefault();
        curvesState[curvesState.activeChannel] = [{ x: 0, y: 0 }, { x: 255, y: 255 }];
        activeCurvePointIdx = -1;
        updateCurvesUI();
        pushCrHistory();
        scheduleRender();
    }, { signal: abortCtrl.signal });

    const stopCurveDrag = () => {
        if (isCurveDragging) {
            isCurveDragging = false;
            activeCurvePointIdx = -1;
            pushCrHistory();
            updateCurvesUI();
        }
    };
    window.addEventListener("mouseup", stopCurveDrag, { signal: abortCtrl.signal });

    // --- END CURVES PANEL ---

    resetCrBtn.onclick = () => {
        for (const key in state) { state[key] = 0; }
        hslState = {
            colorize: false, activeChannel: 'master', 
            master: { h: 0, s: 0, l: 0 }, reds: { h: 0, s: 0, l: 0, center: 0, width: 60 },
            yellows: { h: 0, s: 0, l: 0, center: 60, width: 60 }, greens: { h: 0, s: 0, l: 0, center: 120, width: 60 },
            cyans: { h: 0, s: 0, l: 0, center: 180, width: 60 }, blues: { h: 0, s: 0, l: 0, center: 240, width: 60 },
            magentas: { h: 0, s: 0, l: 0, center: 300, width: 60 }
        };
        curvesState = createDefaultCurveState();
        updateHslUI();
        updateCurvesUI();
        for (const key in state) {
            const iEl = document.getElementById(`cr_input_${key}`);
            const sEl = document.getElementById(`cr_slider_${key}`);
            if (iEl) iEl.value = 0; if (sEl) sEl.value = 0;
        }
        pushCrHistory();
        scheduleRender();
    };

    const actionsWrapper = document.createElement("div");
    actionsWrapper.style.cssText = "display: flex; flex-direction: column; gap: 8px; margin-top: 20px; padding: 12px 0 4px 0; width: 100%;";

    const cancelBtn = document.createElement("button");
    cancelBtn.innerText = "Cancel";
    cancelBtn.style.cssText = "width: 100%; padding: 10px; background: #333; color: #fff; border: none; border-radius: 4px; cursor: pointer; transition: 0.2s; font-weight: bold;";
    cancelBtn.onmouseenter = () => { cancelBtn.style.background = "#444"; };
    cancelBtn.onmouseleave = () => { cancelBtn.style.background = "#333"; };
    
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display: flex; gap: 8px; width: 100%;";

    const saveDiskBtn = document.createElement("button");
    saveDiskBtn.innerText = "Save to Disk";
    saveDiskBtn.style.cssText = "flex: 1; padding: 10px; background: #2a2a2f; color: #fff; border: none; border-radius: 4px; cursor: pointer; transition: 0.2s; font-size: 11px; font-weight: bold;";
    saveDiskBtn.onmouseenter = () => { saveDiskBtn.style.background = "#333a45"; };
    saveDiskBtn.onmouseleave = () => { saveDiskBtn.style.background = "#2a2a2f"; };

    saveDiskBtn.onclick = () => {
        saveDiskBtn.innerText = "Processing...";
        setTimeout(() => {
            const hqW = origImgObj.naturalWidth;
            const hqH = origImgObj.naturalHeight;
            
            const tCvs = document.createElement("canvas");
            tCvs.width = hqW; tCvs.height = hqH;
            const tCtx = tCvs.getContext("2d", { willReadFrequently: true });
            
            let parentFilterStr = "";
            if (node.inputs) {
                const inImageLink = node.inputs.find(inp => inp.name === "in_image");
                if (inImageLink && inImageLink.link !== null && app.graph) {
                    const linkInfo = app.graph.links[inImageLink.link];
                    if (linkInfo) {
                        const originNode = app.graph.getNodeById(linkInfo.origin_id);
                        if (originNode && originNode.comfyClass === "TrixLoadImageAIO" && originNode.imgTagRef) {
                            parentFilterStr = originNode.imgTagRef.style.filter || "";
                            if (parentFilterStr === "none") parentFilterStr = "";
                        }
                    }
                }
            }

            tCtx.filter = parentFilterStr || "none";
            tCtx.drawImage(origImgObj, 0, 0, hqW, hqH);
            tCtx.filter = "none";
            
            const srcImgData = tCtx.getImageData(0, 0, hqW, hqH);
            const outImgData = tCtx.createImageData(hqW, hqH);
            
            processPixels(srcImgData.data, outImgData.data, hqW, hqH, state, hslState, curvesState);
            tCtx.putImageData(outImgData, 0, 0);
            
            const blur = state.cr_blur;
            const scaleRatio = hqW / pW; 

            applyDetailStages(tCtx, hqW, hqH, state, scaleRatio);

            if (blur > 0) {
                const bCvs = document.createElement("canvas");
                bCvs.width = hqW; bCvs.height = hqH;
                const bCtx = bCvs.getContext("2d");
                bCtx.filter = `blur(${(blur/10) * scaleRatio}px)`;
                bCtx.drawImage(tCvs, 0, 0);
                tCtx.clearRect(0, 0, hqW, hqH);
                tCtx.drawImage(bCvs, 0, 0);
            }

            tCvs.toBlob(async (blob) => {
                if (!blob) { console.error("Failed to create blob for saving"); return; }
                const filename = `trix_camera_raw_HQ_${Date.now()}.png`;
                
                if (window.showSaveFilePicker) {
                    try {
                        const handle = await window.showSaveFilePicker({
                            suggestedName: filename,
                            types: [{ description: 'Image Files (*.png;*.jpg;*.jpeg;*.webp)', accept: {'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp']} }]
                        });
                        const writable = await handle.createWritable();
                        await writable.write(blob);
                        await writable.close();
                        saveDiskBtn.innerText = "Save to Disk";
                        return;
                    } catch (err) {
                        saveDiskBtn.innerText = "Save to Disk";
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
                saveDiskBtn.innerText = "Save to Disk";
            }, "image/png");
        }, 50);
    };

    const saveSettingsBtn = document.createElement("button");
    saveSettingsBtn.innerText = "Save Settings";
    saveSettingsBtn.style.cssText = "flex: 1; padding: 10px; background: #2a2a2f; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold; transition: 0.2s;";
    saveSettingsBtn.onmouseenter = () => { saveSettingsBtn.style.background = "#333a45"; };
    saveSettingsBtn.onmouseleave = () => { saveSettingsBtn.style.background = "#2a2a2f"; };

    const saveToNodeBtn = document.createElement("button");
    saveToNodeBtn.innerText = "Save to Node";
    saveToNodeBtn.style.cssText = "flex: 1; padding: 10px; background: #33789a; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; transition: 0.2s; font-size: 11px;";
    saveToNodeBtn.onmouseenter = () => { saveToNodeBtn.style.background = "#3f8eb4"; };
    saveToNodeBtn.onmouseleave = () => { saveToNodeBtn.style.background = "#33789a"; };

    const closeEditor = () => {
        abortCtrl.abort();
        if (document.body.contains(overlay)) document.body.removeChild(overlay);
    };

    cancelBtn.onclick = closeEditor;
    
    saveSettingsBtn.onclick = () => {
        for (const key in state) {
            const w = getW(key);
            if (w) w.value = state[key];
        }
        const crE = getW("cr_enable");
        if (crE) crE.value = true;
        if (node._checkboxCREnable) node._checkboxCREnable.checked = true;
        
        const wHslData = getW("hsl_data");
        const wHslActive = getW("hsl_active");
        if (wHslData) wHslData.value = JSON.stringify(hslState);
        
        let hasHsl = hslState.colorize || ['reds','yellows','greens','cyans','blues','magentas','master'].some(ch => hslState[ch].h !== 0 || hslState[ch].s !== 0 || hslState[ch].l !== 0);
        if (wHslActive) wHslActive.value = hasHsl;
        const wCurveData = getW("curve_data");
        const wCurveActive = getW("curve_active");
        if (wCurveData) wCurveData.value = JSON.stringify(ensureCurveState(curvesState));
        if (wCurveActive) wCurveActive.value = curveHasAdjustments(curvesState);

        if (node.syncHTMLRef) node.syncHTMLRef();
        if (node.updateUIRef) node.updateUIRef();
        if (app.graph) app.graph.setDirtyCanvas(true, true);
        closeEditor();
    };

    saveToNodeBtn.onclick = () => {
        saveToNodeBtn.disabled = true;
        saveToNodeBtn.innerText = "Saving...";
        
        setTimeout(() => {
            const filename = trixCropFilename(node.id);
            const hqW = origImgObj.naturalWidth;
            const hqH = origImgObj.naturalHeight;
            
            const tCvs = document.createElement("canvas");
            tCvs.width = hqW; tCvs.height = hqH;
            const tCtx = tCvs.getContext("2d", { willReadFrequently: true });
            
            let parentFilterStr = "";
            if (node.inputs) {
                const inImageLink = node.inputs.find(inp => inp.name === "in_image");
                if (inImageLink && inImageLink.link !== null && app.graph) {
                    const linkInfo = app.graph.links[inImageLink.link];
                    if (linkInfo) {
                        const originNode = app.graph.getNodeById(linkInfo.origin_id);
                        if (originNode && originNode.comfyClass === "TrixLoadImageAIO" && originNode.imgTagRef) {
                            parentFilterStr = originNode.imgTagRef.style.filter || "";
                            if (parentFilterStr === "none") parentFilterStr = "";
                        }
                    }
                }
            }

            tCtx.filter = parentFilterStr || "none";
            tCtx.drawImage(origImgObj, 0, 0, hqW, hqH);
            tCtx.filter = "none";
            
            const srcImgData = tCtx.getImageData(0, 0, hqW, hqH);
            const outImgData = tCtx.createImageData(hqW, hqH);
            
            processPixels(srcImgData.data, outImgData.data, hqW, hqH, state, hslState, curvesState);
            tCtx.putImageData(outImgData, 0, 0);
            
            const blur = state.cr_blur;
            const scaleRatio = hqW / pW; 

            applyDetailStages(tCtx, hqW, hqH, state, scaleRatio);

            if (blur > 0) {
                const bCvs = document.createElement("canvas");
                bCvs.width = hqW; bCvs.height = hqH;
                const bCtx = bCvs.getContext("2d");
                bCtx.filter = `blur(${(blur/10) * scaleRatio}px)`;
                bCtx.drawImage(tCvs, 0, 0);
                tCtx.clearRect(0, 0, hqW, hqH);
                tCtx.drawImage(bCvs, 0, 0);
            }

            tCvs.toBlob(async (blob) => {
                if (!blob) {
                    console.error("Failed to create blob for saving");
                    saveToNodeBtn.disabled = false;
                    saveToNodeBtn.innerText = "Save to Node";
                    return;
                }
                
                try {
                    const file = new File([blob], filename, { type: "image/png" });
                    const body = new FormData();
                    body.append("image", file, filename);
                    body.append("type", "input");
                    body.append("subfolder", TRIX_AIO_SUBFOLDER);
                    body.append("overwrite", "true");
                    
                    const uploadResp = await fetch("/upload/image", { method: "POST", body: body });
                    if (uploadResp.status === 200) {
                        const uploadData = await uploadResp.json();
                        const fullPath = uploadData.subfolder ? `${uploadData.subfolder}/${uploadData.name}` : uploadData.name;
                        
                        node._trix_image_version = (node._trix_image_version || 0) + 1;
                        const imgWidget = node.widgets.find(w => w.name === "image");
                        if (imgWidget) {
                            node._isChangingImage = true;
                            imgWidget.value = fullPath;
                            if (imgWidget.callback) imgWidget.callback(fullPath);
                        }

                        // Reset all Camera Raw settings on the node since they are now baked into the image
                        for (const key in state) {
                            const w = getW(key);
                            if (w) w.value = 0;
                        }
                        const crE = getW("cr_enable");
                        if (crE) crE.value = false;
                        if (node._checkboxCREnable) node._checkboxCREnable.checked = false;
                        
                        const wHslData = getW("hsl_data");
                        const wHslActive = getW("hsl_active");
                        if (wHslData) wHslData.value = "{}";
                        if (wHslActive) wHslActive.value = false;
                        
                        const wCurveData = getW("curve_data");
                        const wCurveActive = getW("curve_active");
                        if (wCurveData) wCurveData.value = "{}";
                        if (wCurveActive) wCurveActive.value = false;

                        const modeWidget = getW("mode");
                        if (modeWidget) modeWidget.value = "Base";
                        node._showCameraRawMenu = false; 

                        if (node.syncHTMLRef) node.syncHTMLRef();
                        if (node.updateUIRef) node.updateUIRef();
                        if (app.graph) app.graph.setDirtyCanvas(true, true);
                        closeEditor();

                        // Notify downstream nodes to pull the updated preview/image in real-time
                        setTimeout(() => {
                            if (app.graph) {
                                app.graph._nodes.forEach(n => {
                                    if (typeof n.pullLivePreviewRef === "function") {
                                        n.pullLivePreviewRef();
                                    }
                                });
                            }
                        }, 150);
                    } else {
                        throw new Error(`Upload failed: ${uploadResp.status}`);
                    }
                } catch (e) {
                    console.error("Save to Node upload failed", e);
                    alert("Failed to save image to node: " + e);
                    saveToNodeBtn.disabled = false;
                    saveToNodeBtn.innerText = "Save to Node";
                }
            }, "image/png");
        }, 50);
    };

    actionsWrapper.append(cancelBtn, btnRow);
    btnRow.append(saveDiskBtn, saveSettingsBtn, saveToNodeBtn);
    sidebar.appendChild(actionsWrapper);
    overlay.append(workspace, sidebar);
    document.body.appendChild(overlay);

    const initCanvas = () => {
        const MAX_PREVIEW_SIZE = useFullRes ? Infinity : 1200; 
        pW = origImgObj.naturalWidth;
        pH = origImgObj.naturalHeight;
        if (pW > MAX_PREVIEW_SIZE || pH > MAX_PREVIEW_SIZE) {
            const ratio = Math.min(MAX_PREVIEW_SIZE / pW, MAX_PREVIEW_SIZE / pH);
            pW = Math.round(pW * ratio);
            pH = Math.round(pH * ratio);
        }

        const baseCvs = document.createElement("canvas");
        baseCvs.width = pW; baseCvs.height = pH;
        const bCtx = baseCvs.getContext("2d", { willReadFrequently: true });
        
        let parentFilterStr = "";
        if (node.inputs) {
            const inImageLink = node.inputs.find(inp => inp.name === "in_image");
            if (inImageLink && inImageLink.link !== null && app.graph) {
                const linkInfo = app.graph.links[inImageLink.link];
                if (linkInfo) {
                    const originNode = app.graph.getNodeById(linkInfo.origin_id);
                    if (originNode && originNode.comfyClass === "TrixLoadImageAIO" && originNode.imgTagRef) {
                        parentFilterStr = originNode.imgTagRef.style.filter || "";
                        if (parentFilterStr === "none") parentFilterStr = "";
                    }
                }
            }
        }

        bCtx.filter = parentFilterStr || "none";
        bCtx.drawImage(origImgObj, 0, 0, pW, pH);
        bCtx.filter = "none";

        baseImgData = bCtx.getImageData(0, 0, pW, pH).data;
        
        canvas.width = pW; canvas.height = pH;
        
        updateHslUI();
        updateCurvesUI();

        setTimeout(() => {
            centerImage();
            scheduleRender();
        }, 50);
    };

    const renderPixels = (renderOriginal = false, fastMode = false) => {
        if (!baseImgData) return;

        const activeState = renderOriginal ? {
            cr_exp: 0, cr_cont: 0, cr_high: 0, cr_shad: 0, cr_white: 0, cr_black: 0, 
            cr_temp: 0, cr_tint: 0, cr_colorfulness: 0, cr_sat: 0, cr_tex: 0, 
            cr_clar: 0, cr_dehz: 0, cr_grain: 0, cr_sharp: 0, cr_blur: 0, cr_vignette: 0
        } : state;

        const activeHslState = renderOriginal ? {
            colorize: false, master: {h:0,s:0,l:0}, reds: {h:0,s:0,l:0}, yellows: {h:0,s:0,l:0},
            greens: {h:0,s:0,l:0}, cyans: {h:0,s:0,l:0}, blues: {h:0,s:0,l:0}, magentas: {h:0,s:0,l:0}
        } : hslState;
        const activeCurvesState = renderOriginal ? createDefaultCurveState() : curvesState;

        const imgData = new ImageData(pW, pH);
        
        processPixels(baseImgData, imgData.data, pW, pH, activeState, activeHslState, activeCurvesState);

        ctx.putImageData(imgData, 0, 0);
        
        applyDetailStages(ctx, pW, pH, activeState, 1);

        const blur = activeState.cr_blur;

        if (blur > 0) {
            const { canvas: tempCvs, ctx: tCtx } = getBlurCtx(pW, pH);
            tCtx.filter = `blur(${blur/10}px)`;
            tCtx.clearRect(0, 0, pW, pH);
            tCtx.drawImage(canvas, 0, 0);
            ctx.clearRect(0, 0, pW, pH);
            ctx.drawImage(tempCvs, 0, 0);
        }
        
        drawWorkspace();
    };

    const scheduleRender = () => {
        if (renderTimer) clearTimeout(renderTimer);
        
        renderTimer = setTimeout(() => {
            renderPixels(false, false);
        }, 16);
    };

    let isDrawingRAF = false;
    const requestDrawWorkspace = () => {
        if (!isDrawingRAF) {
            isDrawingRAF = true;
            requestAnimationFrame(() => {
                drawWorkspace();
                isDrawingRAF = false;
            });
        }
    };

    const onWheel = (e) => {
        e.preventDefault();
        const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
        const rect = workspace.getBoundingClientRect();
        const mx = e.clientX - rect.left; 
        const my = e.clientY - rect.top;
        const oldZoom = camera.zoom;
        camera.zoom *= zoomDelta;
        camera.zoom = Math.max(0.05, Math.min(camera.zoom, 10));
        camera.x = mx - (mx - camera.x) * (camera.zoom / oldZoom);
        camera.y = my - (my - camera.y) * (camera.zoom / oldZoom);
        requestDrawWorkspace();
    };
    workspace.addEventListener("wheel", onWheel, { signal: abortCtrl.signal });

    workspace.addEventListener("mousedown", (e) => {
        if (hslFingerActive && e.button === 0) {
            hslDragging = true;
            dragStartTargetX = e.clientX;
            
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const x = Math.floor((e.clientX - rect.left) * scaleX);
            const y = Math.floor((e.clientY - rect.top) * scaleY);
            
            if (x >= 0 && x < pW && y >= 0 && y < pH) {
                const pIdx = (y * pW + x) * 4;
                const r = baseImgData[pIdx];
                const g = baseImgData[pIdx+1];
                const b = baseImgData[pIdx+2];
                const [h, s, l] = rgbToHsl(r, g, b);
                
                let minDiff = 360;
                let closestCh = 'master';
                if (!hslState.colorize) {
                    const channels = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'];
                    for (let ch of channels) {
                        let center = hslState[ch].center;
                        let diff = Math.abs(h - center);
                        if (diff > 180) diff = 360 - diff;
                        if (diff < minDiff) { minDiff = diff; closestCh = ch; }
                    }
                    hslState.activeChannel = closestCh;
                    updateHslUI();
                }
            }
            dragStartSat = hslState[hslState.activeChannel].s;
            return;
        }

        if (e.button === 0 || e.button === 1 || e.button === 2) {
            isPanning = true; startMx = e.clientX; startMy = e.clientY;
        }
    }, { signal: abortCtrl.signal });

    workspace.addEventListener("mousemove", (e) => {
        if (hslDragging) {
            let dx = e.clientX - dragStartTargetX;
            let newSat = dragStartSat + Math.round(dx / 2);
            newSat = Math.max(-100, Math.min(100, newSat));
            hslState[hslState.activeChannel].s = newSat;
            updateHslUI();
            scheduleRender();
            return;
        }

        if (isPanning) {
            camera.x += e.clientX - startMx; camera.y += e.clientY - startMy;
            startMx = e.clientX; startMy = e.clientY;
            requestDrawWorkspace();
        }
    }, { signal: abortCtrl.signal });

    const onMouseUp = () => { 
        isPanning = false; 
        if (hslDragging) {
            hslDragging = false;
            pushCrHistory();
        }
    };
    const onResize = () => {
        const currentW = workspace.clientWidth || 0;
        const currentH = workspace.clientHeight || 0;
        if (lastWorkspaceW && lastWorkspaceH) {
            const dw = currentW - lastWorkspaceW;
            const dh = currentH - lastWorkspaceH;
            camera.x += dw / 2;
            camera.y += dh / 2;
        }
        lastWorkspaceW = currentW;
        lastWorkspaceH = currentH;
        drawWorkspace();
    };
    
    window.addEventListener("mouseup", onMouseUp, { signal: abortCtrl.signal });
    window.addEventListener("resize", onResize, { signal: abortCtrl.signal });

    const onKeyDown = (e) => {
        if (e.key === "Escape") {
            e.preventDefault();
            closeEditor();
        }
    };
    window.addEventListener("keydown", onKeyDown, { signal: abortCtrl.signal });

    setTimeout(() => {
        if (origImgObj.complete) { initCanvas(); } 
        else { origImgObj.onload = initCanvas; }
    }, 10);
}

export function processPixels(srcData, targetData, w, h, crState, hState, cState) {
    const exp = crState.cr_exp / 100.0;
    const cont = crState.cr_cont / 100.0;
    const high = crState.cr_high / 100.0;
    const shad = crState.cr_shad / 100.0;
    const white = crState.cr_white / 100.0;
    const black = crState.cr_black / 100.0;
    const temp = crState.cr_temp / 200.0;
    const tint = crState.cr_tint / 400.0;
    const colorful = crState.cr_colorfulness / 100.0;
    const sat = crState.cr_sat / 100.0;
    const dehz = crState.cr_dehz;
    const grain = crState.cr_grain / 200.0;
    const vig = crState.cr_vignette / 50.0;
    const hasHsl = hState.colorize || ['master', 'reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'].some(ch => {
        const conf = hState[ch] || {};
        return conf.h !== 0 || conf.s !== 0 || conf.l !== 0;
    });
    const curveState = ensureCurveState(cState);
    const hasCurve = curveHasAdjustments(curveState);
    const curveRgbLut = hasCurve ? buildCurveLut(curveState.rgb) : null;
    const curveRLut = hasCurve ? buildCurveLut(curveState.r) : null;
    const curveGLut = hasCurve ? buildCurveLut(curveState.g) : null;
    const curveBLut = hasCurve ? buildCurveLut(curveState.b) : null;

    const getHueWeight = (hh, center, width) => {
        let diff = Math.abs(hh - center);
        if (diff > 180) diff = 360 - diff;
        const half = Math.max(5, width / 2);
        const falloff = Math.max(12, half * 0.65);
        if (diff <= half) return 1;
        if (diff <= half + falloff) {
            const t = (diff - half) / falloff;
            return 0.5 * (1 + Math.cos(Math.PI * t));
        }
        return 0;
    };

    for (let i = 0; i < srcData.length; i += 4) {
        let r = srcData[i] / 255.0;
        let g = srcData[i+1] / 255.0;
        let b = srcData[i+2] / 255.0;

        if (temp !== 0 || tint !== 0) {
            r += temp + (tint * 2.0);
            g -= tint * 2.0;
            b -= temp - (tint * 2.0);
        }

        let luma = r * 0.299 + g * 0.587 + b * 0.114;

        if (exp !== 0) {
            const mult = Math.pow(2.0, exp * 2.0);
            r *= mult; g *= mult; b *= mult;
            luma *= mult;
        }

        if (shad !== 0) {
            let mask = (0.72 - luma) / 0.72;
            if (mask < 0) mask = 0; else if (mask > 1) mask = 1;
            mask = mask * mask * (3 - 2 * mask);
            if (shad >= 0) {
                const lift = mask * shad * 0.85;
                r += (1.0 - r) * lift;
                g += (1.0 - g) * lift;
                b += (1.0 - b) * lift;
            } else {
                const darken = mask * (-shad) * 0.8;
                r *= 1.0 - darken;
                g *= 1.0 - darken;
                b *= 1.0 - darken;
            }
        }

        if (high !== 0) {
            let mask = (luma - 0.5) / 0.5;
            if (mask < 0) mask = 0; else if (mask > 1) mask = 1;
            const adj = mask * high * 0.5;
            r += r * adj; g += g * adj; b += b * adj;
        }

        if (white !== 0) {
            const adj = white * 0.5;
            r += r * r * adj; g += g * g * adj; b += b * b * adj;
        }

        if (black !== 0) {
            const adj = black * 0.5;
            r -= (1.0 - r) * (1.0 - r) * adj;
            g -= (1.0 - g) * (1.0 - g) * adj;
            b -= (1.0 - b) * (1.0 - b) * adj;
        }

        if (cont !== 0) {
            const f = 1.0 + cont;
            r = (r - 0.5) * f + 0.5;
            g = (g - 0.5) * f + 0.5;
            b = (b - 0.5) * f + 0.5;
        }

        if (sat !== 0) {
            luma = r * 0.299 + g * 0.587 + b * 0.114;
            r += (r - luma) * sat;
            g += (g - luma) * sat;
            b += (b - luma) * sat;
        }

        if (colorful !== 0) {
            luma = r * 0.299 + g * 0.587 + b * 0.114;
            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const sat_mask = 1.0 - (maxC - minC);
            const adj = colorful * sat_mask;
            r += (r - luma) * adj;
            g += (g - luma) * adj;
            b += (b - luma) * adj;
        }

        if (dehz !== 0) {
            const dehzN = dehz / 150.0;
            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const haze = Math.max(0, Math.min(1, 1 - (maxC - minC) * 2));
            const mid = Math.max(0, Math.min(1, 1 - Math.abs(luma - 0.5) * 2));
            const weight = Math.max(0, Math.min(1, 0.35 + 0.65 * haze * mid));

            if (dehzN > 0) {
                const contrast = 1 + dehzN * 0.9 * weight;
                r = (r - 0.5) * contrast + 0.5;
                g = (g - 0.5) * contrast + 0.5;
                b = (b - 0.5) * contrast + 0.5;
                const neutral = (r + g + b) / 3;
                const satBoost = dehzN * 0.18 * weight;
                r += (r - neutral) * satBoost;
                g += (g - neutral) * satBoost;
                b += (b - neutral) * satBoost;
            } else {
                const soften = (-dehzN) * 0.45 * weight;
                r = (r - 0.5) * (1 - soften) + 0.5;
                g = (g - 0.5) * (1 - soften) + 0.5;
                b = (b - 0.5) * (1 - soften) + 0.5;
            }
        }

        if (vig !== 0) {
            const px = (i / 4) % w;
            const py = Math.floor((i / 4) / w);
            const cx = w / 2;
            const cy = h / 2;
            const radius = Math.sqrt(Math.pow(px - cx, 2) + Math.pow(py - cy, 2));
            const max_rad = Math.sqrt(cx*cx + cy*cy);
            let v_mask = 1.0 - ((radius / max_rad) - 0.3) * vig;
            if (v_mask < 0) v_mask = 0; else if (v_mask > 1) v_mask = 1;
            r *= v_mask; g *= v_mask; b *= v_mask;
        }

        if (grain !== 0) {
            const noise = (Math.random() - 0.5) * 2.0 * grain;
            r += noise; g += noise; b += noise;
        }

        r = Math.max(0, Math.min(1, r));
        g = Math.max(0, Math.min(1, g));
        b = Math.max(0, Math.min(1, b));

        if (hasHsl) {
            let [hh, ss, ll] = rgbToHsl(r * 255, g * 255, b * 255);
            
            if (hState.colorize) {
                hh = hState.master.h;
                if (hh < 0) hh += 360;
                ss = Math.max(0, Math.min(1, 0.5 + (hState.master.s / 100)));
                ll = applyLightnessLikePhotoshop(ll, hState.master.l / 100);
            } else {
                let totalHShift = hState.master.h;
                let totalSMult = Math.exp((hState.master.s / 100) * HSL_SATURATION_LOG);
                let totalLShift = hState.master.l / 100;

                const channels = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'];
                for (let ch of channels) {
                    let conf = hState[ch] || { h: 0, s: 0, l: 0, center: 0, width: 60 };
                    if (conf.h === 0 && conf.s === 0 && conf.l === 0) continue;
                    const center = Number.isFinite(conf.center) ? conf.center : 0;
                    const width = Number.isFinite(conf.width) ? conf.width : 60;
                    let weight = getHueWeight(hh, center, width);
                    if (weight > 0) {
                        totalHShift += conf.h * weight;
                        totalSMult *= Math.exp((conf.s / 100) * HSL_SATURATION_LOG * weight);
                        totalLShift += (conf.l / 100) * weight;
                    }
                }

                hh = (hh + totalHShift) % 360;
                if (hh < 0) hh += 360;
                ss = Math.max(0, Math.min(1, ss * totalSMult));
                ll = applyLightnessLikePhotoshop(ll, totalLShift);
            }

            [r, g, b] = hslToRgb(hh, ss, ll);
            r /= 255; g /= 255; b /= 255;
        }

        if (hasCurve) {
            let ri = Math.max(0, Math.min(255, Math.round(r * 255)));
            let gi = Math.max(0, Math.min(255, Math.round(g * 255)));
            let bi = Math.max(0, Math.min(255, Math.round(b * 255)));

            ri = curveRgbLut[ri];
            gi = curveRgbLut[gi];
            bi = curveRgbLut[bi];
            ri = curveRLut[ri];
            gi = curveGLut[gi];
            bi = curveBLut[bi];

            r = ri / 255;
            g = gi / 255;
            b = bi / 255;
        }

        targetData[i] = r * 255;
        targetData[i+1] = g * 255;
        targetData[i+2] = b * 255;
        targetData[i+3] = srcData[i+3];
    }
}

let cachedBlurCanvas = null;
let cachedBlurCtx = null;

export function getBlurCtx(w, h) {
    if (!cachedBlurCanvas) {
        cachedBlurCanvas = document.createElement("canvas");
        cachedBlurCtx = cachedBlurCanvas.getContext("2d");
    }
    if (cachedBlurCanvas.width !== w || cachedBlurCanvas.height !== h) {
        cachedBlurCanvas.width = w;
        cachedBlurCanvas.height = h;
    }
    return { canvas: cachedBlurCanvas, ctx: cachedBlurCtx };
}

export function applyDetailBlend(targetCtx, w, h, radius, amount, midtoneOnly = false) {
    if (!amount) return;
    const base = targetCtx.getImageData(0, 0, w, h);
    const baseData = base.data;

    const { canvas: blurCanvas, ctx: blurCtx } = getBlurCtx(w, h);
    blurCtx.filter = `blur(${Math.max(0.1, radius)}px)`;
    blurCtx.clearRect(0, 0, w, h);
    blurCtx.drawImage(targetCtx.canvas, 0, 0);
    const blurData = blurCtx.getImageData(0, 0, w, h).data;

    const len = baseData.length;
    for (let i = 0; i < len; i += 4) {
        const r0 = baseData[i];
        const g0 = baseData[i + 1];
        const b0 = baseData[i + 2];
        let weight = 1;
        if (midtoneOnly) {
            const l = (r0 * 0.2126 + g0 * 0.7152 + b0 * 0.0722) / 255;
            weight = 1 - Math.max(0, Math.min(1, Math.abs(l - 0.5) * 2));
            if (weight > 0) {
                weight = Math.pow(weight, 1.25);
            }
        }
        const a = amount * weight;
        baseData[i] = Math.max(0, Math.min(255, r0 + (r0 - blurData[i]) * a));
        baseData[i + 1] = Math.max(0, Math.min(255, g0 + (g0 - blurData[i + 1]) * a));
        baseData[i + 2] = Math.max(0, Math.min(255, b0 + (b0 - blurData[i + 2]) * a));
    }

    targetCtx.putImageData(base, 0, 0);
}

export function applyDetailStages(targetCtx, w, h, crState, scale = 1) {
    const texAmount = crState.cr_tex / 140.0;
    const clarAmount = crState.cr_clar / 130.0;
    const sharpAmount = crState.cr_sharp / 110.0;
    if (texAmount !== 0) applyDetailBlend(targetCtx, w, h, 0.9 * scale, texAmount, false);
    if (clarAmount !== 0) applyDetailBlend(targetCtx, w, h, 2.0 * scale, clarAmount, true);
    if (sharpAmount > 0) applyDetailBlend(targetCtx, w, h, 1.6 * scale, sharpAmount, false);
}

