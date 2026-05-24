import { app } from '../../../scripts/app.js';

const TRIX_AIO_SUBFOLDER = "aio_input";
const CPO_ACCENT = "#33789a";
const CPO_ACCENT_HOVER = "#3f8eb4";
const CPO_BUTTON_BG = "#2a2a2f";
const CPO_BUTTON_HOVER = "#333a45";
const trixCropSafeId = (value) => String(value ?? "node").replace(/[^a-zA-Z0-9_-]+/g, "_") || "node";
const trixCropFilename = (nodeId) => `aio_crop_${trixCropSafeId(nodeId)}.png`;
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
const applyCpoPrimaryHover = (btn) => {
    btn.onmouseenter = () => { btn.style.background = CPO_ACCENT_HOVER; };
    btn.onmouseleave = () => { btn.style.background = CPO_ACCENT; };
};

export function openTrixCropEditor(node, cropWidget) {
    const abortCtrl = new AbortController();
    if (!node.imgTagRef || !node.imgTagRef.naturalWidth) {
        alert("Please load an image first!");
        return;
    }

    const origImgObj = new Image();
    origImgObj.crossOrigin = "Anonymous";
    origImgObj.src = node.imgTagRef.src;

    let origW = node.imgTagRef.naturalWidth;
    let origH = node.imgTagRef.naturalHeight;

    let cropData = { x: 0, y: 0, w: origW, h: origH, color: "#7f7f7f" };
    try {
        if (cropWidget && cropWidget.value && cropWidget.value !== "{}") {
            const parsed = JSON.parse(cropWidget.value);
            cropData = { ...cropData, ...parsed };
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

    const sidebar = document.createElement("div");
    sidebar.style.cssText = `
        width: 280px; height: 100%; background: #151515; border-right: 1px solid #333;
        display: flex; flex-direction: column; padding: 20px; box-sizing: border-box;
        box-shadow: 2px 0 10px rgba(0,0,0,0.5); z-index: 10;
    `;

    const svgTitle = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: text-bottom; margin-right: 6px;"><path d="M3 3v18h18"></path><path d="M3 15h12v-12"></path></svg>`;

    const title = document.createElement("div");
    title.innerHTML = `${svgTitle} Crop / Pad / Outpaint`;
    title.style.cssText = "color: #fff; font-size: 16px; font-weight: bold; margin-bottom: 20px;";
    
    let isLocked = false;
    let lockRatio = cropData.w / cropData.h;
    let activePreset = null;

    const presetRow = document.createElement("div");
    presetRow.style.cssText = "display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 15px;";
    const ratios = [
        { label: "1:1", val: 1/1 }, { label: "1:2", val: 1/2 }, { label: "3:2", val: 3/2 }, { label: "4:3", val: 4/3 },
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

    const sizeContainer = document.createElement("div");
    sizeContainer.style.cssText = "display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;";
    
    const sizeRow = document.createElement("div");
    sizeRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; gap: 8px;";

    const svgSwap = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="14" x2="21" y2="3"></line><polyline points="8 21 3 21 3 16"></polyline><line x1="20" y1="10" x2="3" y2="21"></line></svg>`;

    const swapBtn = document.createElement("button");
    swapBtn.innerHTML = svgSwap;
    swapBtn.style.cssText = "background: #2a2a2f; color: #ccc; border: 1px solid #444; border-radius: 4px; cursor: pointer; padding: 0 8px; height: 26px; margin-top: 15px; transition: 0.2s;";
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
    resetBtn.style.cssText = "background: #2a2a2f; color: #ccc; border: 1px solid #444; border-radius: 4px; padding: 6px; cursor: pointer; font-size: 12px; transition: 0.2s; flex: 1;";
    applyCpoButtonHover(resetBtn);
    resetBtn.onclick = () => {
        cropData = { x: 0, y: 0, w: origW, h: origH, color: cropData.color };
        resizeCanvas();
    };

    const recenterBtn = document.createElement("button");
    recenterBtn.innerHTML = `${svgRecenter} Recenter`;
    recenterBtn.style.cssText = "background: #2a2a2f; color: #ccc; border: 1px solid #444; border-radius: 4px; padding: 6px; cursor: pointer; font-size: 12px; transition: 0.2s; flex: 1;";
    applyCpoButtonHover(recenterBtn);
    recenterBtn.onclick = () => resizeCanvas();

    actionRow.append(resetBtn, recenterBtn);

    const colorRow = document.createElement("div");
    colorRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-top: 5px;";
    const colorLabel = document.createElement("span");
    colorLabel.innerText = "Fill Color:"; colorLabel.style.color = "#aaa"; colorLabel.style.fontSize = "12px";
    const colorInput = document.createElement("input");
    colorInput.type = "color"; colorInput.value = cropData.color;
    colorInput.style.cssText = "background: none; border: none; cursor: pointer; width: 30px; height: 30px; padding: 0;";
    colorInput.oninput = (e) => { cropData.color = e.target.value; draw(); };
    colorRow.append(colorLabel, colorInput);

    const outpaintRow = document.createElement("div");
    outpaintRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; background: #2a2a2a; padding: 8px 10px; margin-top: 5px; border-radius: 6px; border: 1px solid #444; box-shadow: inset 0 1px 2px rgba(0,0,0,0.4);";
    
    const outpaintLabel = document.createElement("span");
    outpaintLabel.innerText = "Auto-Mask Outpaint";
    outpaintLabel.style.cssText = "color: #fff; font-size: 12px; font-weight: bold;";

    const switchContainer = document.createElement("label");
    switchContainer.style.cssText = "position: relative; display: inline-block; width: 34px; height: 18px; margin: 0; cursor: pointer;";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.style.cssText = "opacity: 0; width: 0; height: 0; position: absolute;";
    checkbox.checked = false;

    const track = document.createElement("span");
    track.style.cssText = "position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: #111; transition: .2s; border-radius: 18px; border: 1px solid #555; box-sizing: border-box;";

    const circle = document.createElement("span");
    circle.style.cssText = "position: absolute; content: ''; height: 12px; width: 12px; left: 2px; top: 2px; background: white; transition: .2s; border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,0.5);";

    track.appendChild(circle);
    switchContainer.append(checkbox, track);
    outpaintRow.append(outpaintLabel, switchContainer);

    const featherWidget = node.widgets ? node.widgets.find(w => w.name === "feathering") : null;
    let feathering = featherWidget ? (parseInt(featherWidget.value) || 0) : 0;

    const featherRow = document.createElement("div");
    featherRow.style.cssText = "display: none; align-items: center; justify-content: space-between; background: #2a2a2a; padding: 6px 10px; margin-top: 4px; border-radius: 6px; border: 1px solid #444; gap: 8px;";
    
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
    fInput.onchange = (e) => syncFeather(e.target.value);

    featherRow.append(featherLabel, fSlider, fInput);

    let useOutpaint = false;
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
    snapRow.style.cssText = "display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 20px;";
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

    const calcInfo = document.createElement("div");
    calcInfo.style.cssText = "background: #000; border: 1px solid #333; padding: 15px; border-radius: 6px; text-align: center; color: #aaa; font-family: monospace; font-size: 12px; margin-bottom: auto;";
    
    const updateCalcInfo = () => {
        const cw = Math.round(cropData.w); const ch = Math.round(cropData.h);
        calcInfo.innerHTML = `Original<br><span style="color:#fff">${origW} x ${origH}</span><br><br>Target<br><span style="color:rgb(150, 225, 255); font-size: 16px;">${cw} x ${ch}</span>`;
        if (!isLocked) { wInput.value = cw; hInput.value = ch; }
    };

    const actionsWrapper = document.createElement("div");
    actionsWrapper.style.cssText = "display: flex; flex-direction: column; gap: 8px; margin-top: 20px;";

    const refreshBtn = document.createElement("button");
    refreshBtn.innerText = "Refresh Image";
    refreshBtn.style.cssText = "width: 100%; padding: 10px; background: #2a2a2f; color: #fff; border: none; border-radius: 4px; cursor: pointer; transition: 0.2s; font-size: 11px;";
    applyCpoButtonHover(refreshBtn, () => false, CPO_BUTTON_BG, CPO_BUTTON_HOVER);
    refreshBtn.onclick = () => {
        const isWired = node.inputs && node.inputs.some(inp => inp.name === "in_image" && inp.link !== null);
        if (isWired) {
            if (cropWidget) cropWidget.value = "{}";
            node._currentLiveUrl = null; 
            if (node.pullLivePreviewRef) node.pullLivePreviewRef();
            setTimeout(() => {
                origImgObj.onload = () => {
                    origW = origImgObj.naturalWidth;
                    origH = origImgObj.naturalHeight;
                    cropData = { x: 0, y: 0, w: origW, h: origH, color: cropData.color };
                    resizeCanvas();
                };
                origImgObj.src = node.imgTagRef.src;
            }, 200);
        } else {
            let baseName = node._originalImageForCrop || (node.widgets.find(w => w.name === "image") ? node.widgets.find(w => w.name === "image").value : null);
            if (!baseName) return;
            if (cropWidget) cropWidget.value = "{}";
            
            let filename = baseName; let subfolder = ""; if (baseName.includes("/")) { const parts = baseName.split("/"); filename = parts.pop(); subfolder = parts.join("/"); }
            const url = `/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=${encodeURIComponent(subfolder)}&t=${Date.now()}`;
            
            origImgObj.onload = () => {
                origW = origImgObj.naturalWidth;
                origH = origImgObj.naturalHeight;
                cropData = { x: 0, y: 0, w: origW, h: origH, color: cropData.color };
                const imgWidget = node.widgets.find(w => w.name === "image");
                if (imgWidget) {
                    imgWidget.value = baseName;
                    if (imgWidget.callback) imgWidget.callback(baseName);
                }
                resizeCanvas();
            };
            origImgObj.src = url;
        }
    };

    const btnContainer = document.createElement("div");
    btnContainer.style.cssText = "display: flex; gap: 10px;";

    const closeEditor = () => {
        abortCtrl.abort();
        if (document.body.contains(overlay)) {
            document.body.removeChild(overlay);
        }
    };

    const cancelBtn = document.createElement("button");
    cancelBtn.innerText = "Cancel";
    cancelBtn.style.cssText = "flex: 1; padding: 10px; background: #333; color: #fff; border: none; border-radius: 4px; cursor: pointer; transition: 0.2s;";
    applyCpoButtonHover(cancelBtn, () => false, "#333", "#444");
    cancelBtn.onclick = closeEditor;

    const saveDiskBtn = document.createElement("button");
    saveDiskBtn.innerText = "Save to Disk";
    saveDiskBtn.style.cssText = "flex: 1; padding: 10px; background: #2a2a2f; color: #fff; border: none; border-radius: 4px; cursor: pointer; transition: 0.2s; font-size: 11px;";
    applyCpoButtonHover(saveDiskBtn, () => false, CPO_BUTTON_BG, CPO_BUTTON_HOVER);
    saveDiskBtn.onclick = () => {
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
    saveBtn.innerText = "Save";
    saveBtn.style.cssText = "flex: 1; padding: 10px; background: #33789a; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; transition: 0.2s;";
    applyCpoPrimaryHover(saveBtn);
    
    saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        saveBtn.innerText = "Saving...";
        
        cropData.x = Math.round(cropData.x); cropData.y = Math.round(cropData.y);
        cropData.w = Math.round(cropData.w); cropData.h = Math.round(cropData.h);
        
        const tCanvas = document.createElement("canvas");
        tCanvas.width = cropData.w; tCanvas.height = cropData.h;
        const tCtx = tCanvas.getContext("2d");
        tCtx.fillStyle = cropData.color;
        tCtx.fillRect(0, 0, cropData.w, cropData.h);
        tCtx.drawImage(origImgObj, -cropData.x, -cropData.y);

        const widgets = node.widgets ? node.widgets.reduce((acc, w) => ({...acc, [w.name]: w}), {}) : {};
        if (useOutpaint) {
            const mCvs = document.createElement("canvas");
            mCvs.width = cropData.w; mCvs.height = cropData.h;
            const mCtx = mCvs.getContext("2d");
            
            mCtx.fillStyle = node.maskColor || "#ff0000";
            mCtx.fillRect(0, 0, cropData.w, cropData.h);
            
            let padLeft = -cropData.x;
            let padTop = -cropData.y;
            let padRight = cropData.w - origW + cropData.x;
            let padBottom = cropData.h - origH + cropData.y;
            
            let grow = feathering * 2;
            
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
            
            mCtx.globalCompositeOperation = "destination-out";
            if (feathering > 0) mCtx.filter = `blur(${feathering}px)`;
            mCtx.fillStyle = "black";
            if (clrW > 0 && clrH > 0) mCtx.fillRect(blackX1, blackY1, clrW, clrH);
            
            mCtx.filter = "none";
            mCtx.globalCompositeOperation = "source-over";

            if (widgets.mask_data) widgets.mask_data.value = mCvs.toDataURL("image/png");
            if (widgets.mode) widgets.mode.value = "Mask";
        } else {
            if (widgets.mask_data) widgets.mask_data.value = "";
        }

        const isWired = node.inputs && node.inputs.some(inp => inp.name === "in_image" && inp.link !== null);

        if (!isWired && widgets.image) {
            if (widgets.image.value && !widgets.image.value.includes("aio_crop_")) {
                node._originalImageForCrop = widgets.image.value;
            }
        }

        if (isWired) {
            if (cropWidget) cropWidget.value = JSON.stringify(cropData);
            node.imgTagRef.src = tCanvas.toDataURL("image/png");
            setTimeout(() => { 
                if (node.updateUIRef) node.updateUIRef();
            }, 50); 
            closeEditor();
        } else {
            try {
                const blob = await new Promise(resolve => tCanvas.toBlob(resolve, 'image/png'));
                const filename = trixCropFilename(node.id);
                const file = new File([blob], filename, { type: "image/png" });
                
                const body = new FormData();
                body.append("image", file, filename);
                body.append("type", "input");
                body.append("subfolder", TRIX_AIO_SUBFOLDER);
                body.append("overwrite", "true");
                
                const uploadResp = await fetch("/upload/image", { method: "POST", body: body });
                if (uploadResp.status === 200) {
                    const data = await uploadResp.json();
                    const fullPath = data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
                    
                    if (widgets.image) {
                        widgets.image.value = fullPath;
                        if (widgets.image.callback) widgets.image.callback(fullPath);
                    }
                    if (cropWidget) cropWidget.value = "{}"; 
                }
            } catch(e) {
                console.error("Save to Clipspace failed", e);
            }
            closeEditor();
        }
    };

    btnContainer.append(cancelBtn, saveDiskBtn, saveBtn);
    actionsWrapper.append(refreshBtn, btnContainer);
    sidebar.append(title, presetRow, sizeContainer, snapSeparator, snapLabel, snapRow, calcInfo, actionsWrapper);

    const workspace = document.createElement("div");
    workspace.style.cssText = "flex: 1; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center;";
    
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    workspace.appendChild(canvas);
    overlay.append(sidebar, workspace);
    document.body.appendChild(overlay);

    let camera = { x: 0, y: 0, zoom: 1 };
    let isDragging = false; let dragHandle = null; 
    let startMx = 0, startMy = 0; let startCrop = null; let isPanning = false;

    const resizeCanvas = () => {
        canvas.width = workspace.clientWidth; canvas.height = workspace.clientHeight;
        const fitZoomW = (canvas.width * 0.7) / cropData.w;
        const fitZoomH = (canvas.height * 0.7) / cropData.h;
        camera.zoom = Math.min(fitZoomW, fitZoomH);
        camera.x = canvas.width / 2 - (cropData.x + cropData.w / 2) * camera.zoom;
        camera.y = canvas.height / 2 - (cropData.y + cropData.h / 2) * camera.zoom;
        draw();
    };

    const draw = () => {
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
        ctx.drawImage(origImgObj, imgScreenX, imgScreenY, imgScreenW, imgScreenH);
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
        ctx.drawImage(origImgObj, imgScreenX, imgScreenY, imgScreenW, imgScreenH);
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

        const snapThresh = (5 / 3) / camera.zoom; 
        
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
            if (dragHandle.includes("L") && Math.abs(startCrop.x + dx) < snapThresh) dx = -startCrop.x;
            if (dragHandle.includes("R") && Math.abs(startCrop.x + startCrop.w + dx - origW) < snapThresh) dx = origW - (startCrop.x + startCrop.w);
            if (dragHandle.includes("T") && Math.abs(startCrop.y + dy) < snapThresh) dy = -startCrop.y;
            if (dragHandle.includes("B") && Math.abs(startCrop.y + startCrop.h + dy - origH) < snapThresh) dy = origH - (startCrop.y + startCrop.h);

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
