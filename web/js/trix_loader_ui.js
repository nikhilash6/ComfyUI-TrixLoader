import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js"; 
import { openTrixCameraRawEditor } from './trix_camera_raw.js';
import { openTrixCropEditor } from './trix_crop_editor.js';


api.addEventListener("trix-update-preview", (event) => {
    const { id, images } = event.detail;
    const node = app.graph.getNodeById(id);
    if (node && node.onExecuted) {
        node.onExecuted({ images });
    }
});

const svgCopy = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 6px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
const svgPaste = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 6px;"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>`;
const svgUpload = `<svg viewBox="0 0 24 24" width="11.2" height="11.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M12 3v12"></path><path d="m7 8 5-5 5 5"></path><path d="M5 21h14"></path><path d="M5 17v4"></path><path d="M19 17v4"></path></svg>`;
const svgChevronLeft = `<svg viewBox="0 0 12 12" width="9" height="9" fill="currentColor" aria-hidden="true" style="display: block;"><path d="M8.2 1.1 3.1 6l5.1 4.9V1.1Z"></path></svg>`;
const svgChevronRight = `<svg viewBox="0 0 12 12" width="9" height="9" fill="currentColor" aria-hidden="true" style="display: block;"><path d="M3.8 1.1 8.9 6l-5.1 4.9V1.1Z"></path></svg>`;

const TRIX_BG = "#202024";
const TRIX_PANEL = "#252529";
const TRIX_PANEL_SOFT = "rgba(32, 32, 36, 0.92)";
const TRIX_CONTROL = "#2e2e33";
const TRIX_CONTROL_HOVER = "#393941";
const TRIX_BORDER = "#424248";
const TRIX_NODE_OUTLINE = "#35343c";
const TRIX_NODE_RADIUS = 8;
const TRIX_HEADER_OFFSET_Y = -5; // Custom image picker vertical offset. Change by 1-3px if old native lines peek through.
const TRIX_TEXT = "#e7e7ea";
const TRIX_MUTED = "#a9a9b0";
const TRIX_ACCENT = "#33789a";
const TRIX_ACCENT_HOVER = "#3f8eb4";
const TRIX_ACTIVE = "rgb(246, 103, 68)";
const TRIX_IMAGE_TOOLBAR_GAP = 8; // Gap under the toolbar before the image; raise/lower by 1px if Mask touches the preview.
const TRIX_DISPLAY_TITLE = "🌊Load Image AIO";
const TRIX_AIO_SUBFOLDER = "aio_input";

const applyTrixNodeChrome = (node) => {
    if (!node) return;
    if (!Object.getOwnPropertyDescriptor(node, "color") || Object.getOwnPropertyDescriptor(node, "color").get === undefined) {
        Object.defineProperty(node, "color", {
            get: function() { return TRIX_NODE_OUTLINE; },
            set: function(v) {},
            configurable: true,
            enumerable: true
        });
    }
    if (!Object.getOwnPropertyDescriptor(node, "bgcolor") || Object.getOwnPropertyDescriptor(node, "bgcolor").get === undefined) {
        Object.defineProperty(node, "bgcolor", {
            get: function() { return TRIX_BG; },
            set: function(v) {},
            configurable: true,
            enumerable: true
        });
    }
};

const refreshTrixOutputs = (node) => {
    if (!node || !node.outputs) return;
    
    // Ensure node has exactly 3 outputs
    while (node.outputs.length < 3) {
        node.addOutput("original_input", "IMAGE");
    }
    while (node.outputs.length > 3) {
        node.removeOutput(node.outputs.length - 1);
    }
    
    // Enforce correct types/names for indices 0 and 1
    if (node.outputs[0]) {
        node.outputs[0].name = "IMAGE";
        node.outputs[0].type = "IMAGE";
    }
    if (node.outputs[1]) {
        node.outputs[1].name = "MASK";
        node.outputs[1].type = "MASK";
    }
    
    // Check if in_image input is connected
    const inImageLink = node.inputs ? node.inputs.find(inp => inp && inp.name === "in_image") : null;
    const isWired = inImageLink && inImageLink.link !== null;
    
    if (node.outputs[2]) {
        if (isWired) {
            // Disconnect slot 2 output if there is any active link
            if (node.outputs[2].links && node.outputs[2].links.length > 0) {
                node.disconnectOutput(2);
            }
            node.outputs[2].type = "DISABLED";
            node.outputs[2].label = "original_input (blocked)";
            node.outputs[2].name = "original_input";
        } else {
            node.outputs[2].type = "IMAGE";
            node.outputs[2].label = "original_input";
            node.outputs[2].name = "original_input";
        }
    }
};

const hideWidget = (w) => {
    if (!w) return;
    w.type = "hidden";
    w.computeSize = () => [0, -4];
    w.draw = () => {};
};

const trixSafeId = (value) => String(value ?? "node").replace(/[^a-zA-Z0-9_-]+/g, "_") || "node";
const trixSafeStem = (name, fallback = "image") => {
    const raw = String(name || fallback).split(/[\\/]/).pop().replace(/\.[^.]*$/, "");
    const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
    return safe || fallback;
};
const trixImageExt = (name = "", mime = "") => {
    const match = String(name || "").toLowerCase().match(/\.(png|jpe?g|webp|bmp|gif|tiff?|avif)$/);
    if (match) return match[0] === ".jpeg" ? ".jpg" : match[0];
    const byMime = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/bmp": ".bmp",
        "image/gif": ".gif",
        "image/tiff": ".tiff",
        "image/avif": ".avif",
    };
    return byMime[String(mime || "").toLowerCase()] || ".png";
};
const trixAioFilename = (kind, nodeId, originalName = "", mime = "") => {
    const id = trixSafeId(nodeId);
    const ext = trixImageExt(originalName, mime);
    if (kind === "paste") return `aio_pasted_${id}${ext}`;
    if (kind === "crop") return `aio_crop_${id}.png`;
    const stem = trixSafeStem(originalName, "image");
    return `aio_upload_${id}_${stem}${ext}`;
};
const trixAppendAioUploadFields = (body) => {
    body.append("type", "input");
    body.append("subfolder", TRIX_AIO_SUBFOLDER);
    body.append("overwrite", "true");
};
const trixAioFullPath = (data) => data?.subfolder ? `${data.subfolder}/${data.name}` : data?.name;
const trixDefaultUploadFullPath = (data) => data?.subfolder ? `${data.subfolder}/${data.name}` : data?.name;

const drawRoundedNodeStroke = (ctx, x, y, w, h, radius) => {
    const r = Math.max(0, Math.min(radius, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.stroke();
};

const getMaskHistoryLimit = (canvas) => {
    const pixels = Math.max(0, (canvas?.width || 0) * (canvas?.height || 0));
    if (pixels > 24000000) return 5;
    if (pixels > 12000000) return 8;
    return 15;
};

app.registerExtension({
    name: "Trix.LoadImageAIO",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "TrixLoadImageAIO") {
            Object.defineProperty(nodeType.prototype, "color", {
                get: function() { return TRIX_NODE_OUTLINE; },
                set: function(v) {},
                configurable: true,
                enumerable: true
            });
            Object.defineProperty(nodeType.prototype, "bgcolor", {
                get: function() { return TRIX_BG; },
                set: function(v) {},
                configurable: true,
                enumerable: true
            });

            nodeType.prototype.getTooltip = function() {
                return `Professional loader/masking/resizing/cropping/outpainting image tool`;
            };

            const onConfigureOriginal = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function(info) {
                this._isConfiguring = true; 
                this._isFirstLoad = false; 
                if (onConfigureOriginal) onConfigureOriginal.apply(this, arguments);
                applyTrixNodeChrome(this);
                refreshTrixOutputs(this);
                if (info.size) {
                    this.size = [info.size[0], info.size[1]];
                    this._loadedSize = [...info.size];
                }
                
                if (this.syncHTMLRef) this.syncHTMLRef();
                if (this.updateUIRef) this.updateUIRef(true);

                setTimeout(() => {
                    this._isConfiguring = false;
                }, 1500); 
            };

            const onCloneOriginal = nodeType.prototype.clone;
            nodeType.prototype.clone = function() {
                const cloned = onCloneOriginal ? onCloneOriginal.apply(this, arguments) : LiteGraph.LGraphNode.prototype.clone.call(this);
                cloned._loadedSize = [...this.size];
                cloned._isFirstLoad = false; 
                return cloned;
            };

            const origAddWidget = nodeType.prototype.addWidget || LiteGraph.LGraphNode.prototype.addWidget;
            nodeType.prototype.addWidget = function(type, name, val, cb, extra) {
                const w = origAddWidget.apply(this, arguments);
                if (w && typeof name === "string") {
                    const normalizedName = name.toLowerCase();
                    const normalizedType = String(type || w.type || "").toLowerCase();
                    if (
                        normalizedName === "choose file to upload" ||
                        (normalizedName.includes("choose") && normalizedName.includes("upload")) ||
                        ((normalizedName === "upload" || normalizedName === "image_upload") && normalizedType === "button")
                    ) {
                        hideWidget(w);
                        if (this.widgets) {
                            const idx = this.widgets.indexOf(w);
                            if (idx !== -1) this.widgets.splice(idx, 1);
                        }
                        return w;
                    }
                    const hideNames = ["mask_data", "crop_data", "cr_enable", "hsl_active", "hsl_data", "curve_active", "curve_data", "width", "height", "pad_left", "pad_top", "pad_right", "pad_bottom", "upscale_method", "keep_proportion", "scale_by", "condition", "feathering", "divisible_by", "enable_resize"];
                    if (hideNames.includes(name) || name.startsWith("cr_") || name.startsWith("hsl_") || name.startsWith("curve_")) {
                        hideWidget(w);
                    }
                }
                return w;
            };

            const origGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
            nodeType.prototype.getExtraMenuOptions = function(canvas, options) {
                if (origGetExtraMenuOptions) {
                    origGetExtraMenuOptions.apply(this, arguments);
                }
                
                options.push(null); 
                
                if (this.imgTagRef && this.imgTagRef.complete && this.imgTagRef.naturalWidth > 0) {
                    options.push({
                        content: `${svgCopy} Copy Image`,
                        callback: () => {
                            try {
                                const tCanvas = document.createElement("canvas");
                                tCanvas.width = this.imgTagRef.naturalWidth;
                                tCanvas.height = this.imgTagRef.naturalHeight;
                                const tCtx = tCanvas.getContext("2d");
                                tCtx.drawImage(this.imgTagRef, 0, 0);
                                tCanvas.toBlob(async (blob) => {
                                    if (blob) {
                                        await navigator.clipboard.write([
                                            new ClipboardItem({ "image/png": blob })
                                        ]);
                                    }
                                }, "image/png");
                            } catch (err) {
                                console.error("TrixLoader Copy Image Error:", err);
                                alert("Не удалось скопировать изображение.");
                            }
                        }
                    });
                }

                options.push({
                    content: `${svgPaste} Paste Image`,
                    callback: async () => {
                        try {
                            const items = await navigator.clipboard.read();
                            for (let item of items) {
                                if (item.types.some(t => t.startsWith('image/'))) {
                                    const blob = await item.getType(item.types.find(t => t.startsWith('image/')));
                                    const filename = trixAioFilename("paste", this.id, "", blob.type);
                                    const newFile = new File([blob], filename, { type: blob.type || "image/png" }); 
                                    const body = new FormData(); body.append("image", newFile, filename); trixAppendAioUploadFields(body);
                                    const resp = await fetch("/upload/image", { method: "POST", body: body }); 
                                    if (resp.status === 200) { 
                                        const data = await resp.json(); 
                                        const finalName = trixAioFullPath(data);
                                        const imgWidget = this.widgets.find(w => w.name === "image");
                                        if (imgWidget) { imgWidget.value = finalName; if (imgWidget.callback) imgWidget.callback(finalName); } 
                                    }
                                    break;
                                }
                            }
                        } catch (err) {
                            alert("Failed to paste image: " + err);
                        }
                    }
                });

                options.push(null);
                options.push({
                    content: `${svgCopy} Copy Mask`,
                    callback: () => {
                        if (!this.maskCanvasRef) return;
                        try {
                            this.maskCanvasRef.toBlob(async (blob) => {
                                if (blob) {
                                    await navigator.clipboard.write([
                                        new ClipboardItem({ "image/png": blob })
                                    ]);
                                }
                            }, "image/png");
                        } catch (err) {
                            console.error("TrixLoader Copy Mask Error:", err);
                        }
                    }
                });

                options.push({
                    content: `${svgPaste} Paste Mask`,
                    callback: async () => {
                        if (!this.maskCanvasRef) return;
                        try {
                            const items = await navigator.clipboard.read();
                            for (let item of items) {
                                if (item.types.some(t => t.startsWith('image/'))) {
                                    const blob = await item.getType(item.types.find(t => t.startsWith('image/')));
                                    const img = new Image();
                                    img.onload = () => {
                                        const mctx = this.maskCanvasRef.getContext("2d", { willReadFrequently: true });
                                        mctx.globalCompositeOperation = "source-over";
                                        mctx.drawImage(img, 0, 0, this.maskCanvasRef.width, this.maskCanvasRef.height);
                                        if (this.saveHistoryRef) this.saveHistoryRef();
                                        if (app.graph) app.graph.setDirtyCanvas(true, true);
                                    };
                                    img.src = URL.createObjectURL(blob);
                                    break;
                                }
                            }
                        } catch (err) {
                            alert("Failed to paste mask: " + err);
                        }
                    }
                });
            };

            const doFloodFillWorker = (mctx, startX, startY, fillR, fillG, fillB, fillA, tolerance) => {
                return new Promise((resolve) => {
                    const w = mctx.canvas.width; const h = mctx.canvas.height;
                    startX = Math.floor(startX); startY = Math.floor(startY);
                    
                    if (startX < 0 || startX >= w || startY < 0 || startY >= h) { resolve(); return; }
                    
                    const imgData = mctx.getImageData(0, 0, w, h);
                    
                    const workerCode = `
                        self.onmessage = function(e) {
                            const { imgData, startX, startY, fillR, fillG, fillB, fillA, tolerance, w, h } = e.data;
                            const pixels = imgData.data;
                            const startIdx = (startY * w + startX) * 4;
                            const sr = pixels[startIdx]; const sg = pixels[startIdx + 1]; const sb = pixels[startIdx + 2]; const sa = pixels[startIdx + 3];
                            
                            if (Math.abs(sr - fillR) <= tolerance && Math.abs(sg - fillG) <= tolerance && Math.abs(sb - fillB) <= tolerance && Math.abs(sa - fillA) <= tolerance) {
                                self.postMessage(imgData); return;
                            }
                            
                            const saWeight = sa / 255.0; const psr = sr * saWeight; const psg = sg * saWeight; const psb = sb * saWeight;
                            const stack = [startX, startY]; const filledMap = new Uint8Array(w * h);
                            
                            const match = (idx) => {
                                const r = pixels[idx], g = pixels[idx+1], b = pixels[idx+2], a = pixels[idx+3];
                                const aWeight = a / 255.0;
                                return (Math.abs((r * aWeight) - psr) <= tolerance && Math.abs((g * aWeight) - psg) <= tolerance && Math.abs((b * aWeight) - psb) <= tolerance && Math.abs(a - sa) <= tolerance);
                            };
                            
                            while (stack.length > 0) {
                                const y = stack.pop(); const x = stack.pop();
                                let lx = x; while (lx >= 0 && match((y * w + lx) * 4)) lx--; lx++;
                                let rx = x; while (rx < w && match((y * w + rx) * 4)) rx++; rx--;
                                
                                let spanUp = false; let spanDown = false;
                                for (let i = lx; i <= rx; i++) {
                                    const pixelIdx = y * w + i; const dataIdx = pixelIdx * 4;
                                    pixels[dataIdx] = fillR; pixels[dataIdx+1] = fillG; pixels[dataIdx+2] = fillB; pixels[dataIdx+3] = fillA; filledMap[pixelIdx] = 1; 
                                    
                                    if (y > 0) { if (match(((y - 1) * w + i) * 4)) { if (!spanUp) { stack.push(i, y - 1); spanUp = true; } } else { spanUp = false; } }
                                    if (y < h - 1) { if (match(((y + 1) * w + i) * 4)) { if (!spanDown) { stack.push(i, y + 1); spanDown = true; } } else { spanDown = false; } }
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
                                                            const nx = x + dx; const ny = y + dy;
                                                            if (nx >= 0 && nx < w && ny >= 0 && ny < h && filledMap[ny * w + nx] === 0) {
                                                                const nidx = (ny * w + nx) * 4;
                                                                pixels[nidx] = fillR; pixels[nidx+1] = fillG; pixels[nidx+2] = fillB; pixels[nidx+3] = fillA;
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
                        mctx.putImageData(e.data, 0, 0);
                        worker.terminate();
                        resolve();
                    };
                    worker.postMessage({ imgData, startX, startY, fillR, fillG, fillB, fillA, tolerance, w, h });
                });
            };

            nodeType.prototype.getLayoutMetrics = function() {
                if (!this.imgTagRef || !this.imgTagRef.naturalWidth) return null;

                let nativeHeight = 36;
                if (typeof LiteGraph !== "undefined" && LiteGraph.NODE_TITLE_HEIGHT) {
                    nativeHeight = LiteGraph.NODE_TITLE_HEIGHT + 6;
                }
                
                const uiWidget = this.widgets ? this.widgets.find(w => w && w.name === "trix_ui_v2") : null;
                if (uiWidget && uiWidget.last_y !== undefined && uiWidget.last_y > 0) {
                    nativeHeight = uiWidget.last_y;
                } else if (this.widgets) {
                    for (let wgt of this.widgets) {
                        if (wgt && wgt.name === "trix_ui_v2") break;
                        if (wgt && wgt.type !== "hidden") {
                            nativeHeight += (wgt.computeSize ? wgt.computeSize()[1] : (typeof LiteGraph !== "undefined" ? LiteGraph.NODE_WIDGET_HEIGHT : 20)) + 4;
                        }
                    }
                }

                const headerH = this.headerContainerRef ? Math.max(50, this.headerContainerRef.offsetHeight || 0) : 88; 
                const headerMarginTop = TRIX_HEADER_OFFSET_Y;
                const padX = 6;
                const padTop = 4;
                const padBottom = 4;
                const gap = TRIX_IMAGE_TOOLBAR_GAP;

                const availableW = this.size[0] - (padX * 2);
                const availableH = this.size[1] - nativeHeight - padTop - headerMarginTop - headerH - gap - padBottom;

                if (availableW <= 0 || availableH <= 0) return null;

                const aspect = this.imgTagRef.naturalHeight / this.imgTagRef.naturalWidth;
                let w = availableW;
                let h = w * aspect;

                if (h > availableH) {
                    h = availableH;
                    w = h / aspect;
                }

                const centerX = (availableW - w) / 2;
                const centerY = (availableH - h) / 2;

                const graphX = padX + centerX;
                const graphY = nativeHeight + padTop + headerMarginTop + headerH + gap + centerY;

                const CALIBRATE_X = 3; 
                const CALIBRATE_Y = -2; 

                const localX = centerX + CALIBRATE_X;
                const localY = centerY + CALIBRATE_Y;

                return {
                    graphX, graphY,
                    localX, localY,
                    availableW, availableH,
                    w, h,
                    scale: w / this.imgTagRef.naturalWidth
                };
            };

            nodeType.prototype.getImageRect = function() {
                const m = this.getLayoutMetrics();
                return m ? { x: m.graphX, y: m.graphY, w: m.w, h: m.h, scale: m.scale } : null;
            };

            nodeType.prototype.drawTrixPreview = function(ctx, coverNodeBody = false) {
                const modeWidget = this.widgets ? this.widgets.find(w => w && w.name === "mode") : null;
                const mode = modeWidget ? modeWidget.value : "Base";
                if (mode === "Resize" && !this.isFullscreen) return;
                if (mode === "Base" && this._showCameraRawMenu) return; 

                if (this.imgTagRef && this.imgTagRef.naturalWidth > 0 && !this.isPreviewHidden && !this.isFullscreen) {
                    const rect = this.getImageRect();
                    if (!rect) return;
                    
                    ctx.save();

                    if (coverNodeBody) {
                        const fillX = 1;
                        const fillY = Math.max(0, Math.floor(rect.y) - 2);
                        const fillW = Math.max(1, this.size[0] - 2);
                        const fillH = Math.max(1, this.size[1] - fillY - 1);
                        const r = Math.max(0, Math.min(TRIX_NODE_RADIUS, fillW / 2, fillH / 2));

                        ctx.fillStyle = TRIX_BG;
                        ctx.beginPath();
                        ctx.moveTo(fillX, fillY);
                        ctx.lineTo(fillX + fillW, fillY);
                        ctx.lineTo(fillX + fillW, fillY + fillH - r);
                        ctx.quadraticCurveTo(fillX + fillW, fillY + fillH, fillX + fillW - r, fillY + fillH);
                        ctx.lineTo(fillX + r, fillY + fillH);
                        ctx.quadraticCurveTo(fillX, fillY + fillH, fillX, fillY + fillH - r);
                        ctx.lineTo(fillX, fillY);
                        ctx.closePath();
                        ctx.fill();
                    }
                    
                    ctx.drawImage(this.imgTagRef, rect.x, rect.y, rect.w, rect.h);
                    
                    if (this.maskCanvasRef && !this._isMaskHidden) {
                        ctx.shadowColor = "transparent"; 
                        ctx.globalAlpha = 0.8;
                        ctx.drawImage(this.maskCanvasRef, rect.x, rect.y, rect.w, rect.h);
                    }
                    ctx.restore();
                }
            };

            nodeType.prototype.onDrawBackground = function(ctx) {
                if (!Object.getOwnPropertyDescriptor(this, "color") || Object.getOwnPropertyDescriptor(this, "color").get === undefined) {
                    Object.defineProperty(this, "color", {
                        get: function() { return TRIX_NODE_OUTLINE; },
                        set: function(v) {},
                        configurable: true,
                        enumerable: true
                    });
                }
                if (!Object.getOwnPropertyDescriptor(this, "bgcolor") || Object.getOwnPropertyDescriptor(this, "bgcolor").get === undefined) {
                    Object.defineProperty(this, "bgcolor", {
                        get: function() { return TRIX_BG; },
                        set: function(v) {},
                        configurable: true,
                        enumerable: true
                    });
                }
                
                // Draw the body background starting at y = 0 to cover the header color in the slot area
                const nodeRadius = (typeof LiteGraph !== "undefined" && Number.isFinite(LiteGraph.ROUND_RADIUS)) ? LiteGraph.ROUND_RADIUS : TRIX_NODE_RADIUS;
                ctx.save();
                ctx.fillStyle = TRIX_BG;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(this.size[0], 0);
                ctx.lineTo(this.size[0], this.size[1] - nodeRadius);
                ctx.quadraticCurveTo(this.size[0], this.size[1], this.size[0] - nodeRadius, this.size[1]);
                ctx.lineTo(nodeRadius, this.size[1]);
                ctx.quadraticCurveTo(0, this.size[1], 0, this.size[1] - nodeRadius);
                ctx.closePath();
                ctx.fill();
                ctx.restore();

                if (this.pullLivePreviewRef) this.pullLivePreviewRef();
            };

            nodeType.prototype.onNodeCreated = function() {
                const node = this;
                node.properties = node.properties || {};
                if (!node.title || node.title.toLowerCase().includes("load image aio")) {
                    node.title = TRIX_DISPLAY_TITLE;
                }
                
                node.size = [300, 350]; 
                applyTrixNodeChrome(node);
                node._isFirstLoad = true;
                
                node.maskColor = "#ff0000"; node.brushSize = 100; node.resizable = true;
                node.brushHardness = 1.0; 
                node.isEraser = false; node.history = []; node.historyIndex = -1; node.isPreviewHidden = false; node.isFullscreen = false; 
                node._isMaskHidden = false; node._isToolbarHidden = false; node._lastImageName = null; node._lastMode = "Base"; node._isChangingImage = false;
                node._fsZoom = 1.0; node._fsPanX = 0; node._fsPanY = 0;
                node._lastClickPos = null; node._dragStartX = 0; node._dragStartY = 0; node._shiftLockAxis = null; node._wasShiftDrawing = false; 
                node._isConfiguring = false;
                node._showCameraRawMenu = false; 
                node._originalImageForCrop = null;
                
                node._currentLiveUrl = null; 

                node._onVisChange = () => {
                    if (document.visibilityState === 'visible') {
                        if (node.syncMaskToCanvas) node.syncMaskToCanvas();
                        if (node.updateUIRef) node.updateUIRef();
                    }
                };
                document.addEventListener("visibilitychange", node._onVisChange);

                node.syncMaskToCanvas = function() {
                    if (!this.maskCanvasRef || this.maskCanvasRef.width === 0) return Promise.resolve(false);
                    
                    const wgt = this.widgets ? this.widgets.find(w => w.name === "mask_data") : null;
                    if (!wgt || !wgt.value || !wgt.value.startsWith("data:image")) return Promise.resolve(false);

                    return new Promise((resolve) => {
                        const mctx = this.maskCanvasRef.getContext("2d", { willReadFrequently: true });
                        const img = new Image();
                        img.onload = () => {
                            mctx.globalCompositeOperation = "source-over";
                            mctx.clearRect(0, 0, this.maskCanvasRef.width, this.maskCanvasRef.height);
                            mctx.drawImage(img, 0, 0, this.maskCanvasRef.width, this.maskCanvasRef.height);
                            if (this.isEraser) mctx.globalCompositeOperation = "destination-out";
                            
                            if (this.history.length === 0) {
                                this.history.push(wgt.value);
                                this.historyIndex = 0;
                            }
                            
                            if (app.graph) app.graph.setDirtyCanvas(true, true);
                            resolve(true);
                        };
                        img.onerror = () => resolve(false);
                        img.src = wgt.value;
                    });
                };

                node.saveHistoryRef = function() {
                    const data = this.maskCanvasRef.toDataURL(); 
                    if (this.historyIndex < this.history.length - 1) {
                        this.history = this.history.slice(0, this.historyIndex + 1); 
                    }
                    this.history.push(data); 
                    const historyLimit = getMaskHistoryLimit(this.maskCanvasRef);
                    while (this.history.length > historyLimit) this.history.shift(); 
                    this.historyIndex = this.history.length - 1; 
                    
                    if (this.widgets) {
                        const mData = this.widgets.find(w => w.name === "mask_data");
                        if (mData) mData.value = data;
                    }
                };


                node.pullLivePreviewRef = () => {
                    if (!node.inputs) return;
                    const inImageLink = node.inputs.find(inp => inp.name === "in_image");
                    if (!inImageLink || inImageLink.link === null) {
                        node._currentLiveUrl = null;
                        return;
                    }

                    const linkInfo = app.graph.links[inImageLink.link];
                    if (!linkInfo) return;

                    const originNode = app.graph.getNodeById(linkInfo.origin_id);
                    if (!originNode) return;

                    let imageUrl = null;

                    if (originNode.comfyClass === "TrixLoadImageAIO" && originNode.imgTagRef && originNode.imgTagRef.src) {
                        imageUrl = originNode.imgTagRef.src;
                    } else if (originNode.widgets) {
                        const imgWgt = originNode.widgets.find(w => w.name === "image");
                        if (imgWgt && imgWgt.value && typeof imgWgt.value === 'string') {
                            let filename = imgWgt.value;
                            let subfolder = "";
                            if (filename.includes("/")) {
                                const parts = filename.split("/");
                                filename = parts.pop();
                                subfolder = parts.join("/");
                            }
                            imageUrl = `/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=${encodeURIComponent(subfolder)}`;
                        }
                    }
                    
                    if (!imageUrl) {
                        if (originNode.imgs && originNode.imgs.length > 0 && originNode.imgs[0].src) {
                            imageUrl = originNode.imgs[0].src;
                        } else if (originNode.images && originNode.images.length > 0) {
                            const img_info = originNode.images[0];
                            imageUrl = `/view?filename=${encodeURIComponent(img_info.filename)}&type=${img_info.type}&subfolder=${encodeURIComponent(img_info.subfolder || "")}`;
                        }
                    }

                    if (imageUrl) {
                        const stripT = (str) => str ? str.replace(/([&?])t=\d+/, '').replace(/&$/, '').replace(/\?$/, '') : null;
                        const cleanCurrent = stripT(node._currentLiveUrl);
                        const cleanNew = stripT(imageUrl);

                        if (cleanCurrent !== cleanNew) {
                            node._currentLiveUrl = cleanNew; 
                            if (node.imgTagRef) {
                                const sep = cleanNew.includes('?') ? '&' : '?';
                                
                                const originalOnload = node.imgTagRef.onload;
                                node.imgTagRef.onload = (e) => {
                                    if (originalOnload) originalOnload(e);
                                    
                                    node.maskCanvasRef.width = node.imgTagRef.naturalWidth;
                                    node.maskCanvasRef.height = node.imgTagRef.naturalHeight;
                                    node.alignCanvasRef();
                                    node.syncMaskToCanvas();
                                    
                                    if (app.graph) app.graph.setDirtyCanvas(true, true);
                                    node.imgTagRef.onload = originalOnload;
                                };

                                node.imgTagRef.src = cleanNew + sep + 't=' + Date.now();
                            }
                        }
                    }
                };
                
                node._syncHTMLWithWidgets = [];

                setTimeout(() => {
                    refreshTrixOutputs(node);
                    if (app.graph) {
                        app.graph.setDirtyCanvas(true, true);
                    }
                }, 500);

                node.tempHistoryImg = new Image();

                node.tempHistoryImg.onload = () => {
                    const mctx = node.maskCanvasRef.getContext("2d", { willReadFrequently: true });
                    mctx.globalCompositeOperation = "source-over";
                    mctx.clearRect(0, 0, node.maskCanvasRef.width, node.maskCanvasRef.height); 
                    mctx.drawImage(node.tempHistoryImg, 0, 0, node.maskCanvasRef.width, node.maskCanvasRef.height);
                    if (node.isEraser) mctx.globalCompositeOperation = "destination-out";
                    
                    if (node.alignCanvasRef) node.alignCanvasRef();
                    if (app.graph) app.graph.setDirtyCanvas(true, true);
                };

                const findW = (name) => node.widgets ? node.widgets.find(w => w && w.name === name) : undefined;
                
                const widgets = {
                    get mode() { return findW("mode"); },
                    get mask_data() { return findW("mask_data"); },
                    get crop_data() { return findW("crop_data"); },
                    get image() { return findW("image"); },
                    get enable_resize() { return findW("enable_resize"); },
                    get cr_enable() { return findW("cr_enable"); },
                    get resize() { return node.widgets ? node.widgets.filter(w => w && ["width", "height", "pad_left", "pad_top", "pad_right", "pad_bottom", "upscale_method", "keep_proportion", "scale_by", "condition", "feathering", "divisible_by", "enable_resize"].includes(w.name)) : []; }
                };

                const removeNativeUploadWidget = () => {
                    if (!node.widgets) return;
                    for (let i = node.widgets.length - 1; i >= 0; i--) {
                        const widget = node.widgets[i];
                        const widgetName = String(widget?.name || "").toLowerCase();
                        const widgetType = String(widget?.type || "").toLowerCase();
                        if (
                            widgetName === "choose file to upload" ||
                            (widgetName.includes("choose") && widgetName.includes("upload")) ||
                            ((widgetName === "upload" || widgetName === "image_upload") && widgetType === "button")
                        ) {
                            node.widgets.splice(i, 1);
                        }
                    }
                };
                removeNativeUploadWidget();

                const gcd = (a, b) => {
                    a = Math.abs(Math.round(a));
                    b = Math.abs(Math.round(b));
                    while (b) {
                        const t = b;
                        b = a % b;
                        a = t;
                    }
                    return a || 1;
                };

                const cleanRatioNumber = (value) => {
                    const rounded = Number(value).toFixed(2);
                    return rounded.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
                };

                const formatAspect = (w, h) => {
                    if (!w || !h) return "[?]";
                    const divisor = gcd(w, h);
                    const rw = Math.round(w / divisor);
                    const rh = Math.round(h / divisor);
                    if (rw <= 64 && rh <= 64) return `[${rw}:${rh}]`;
                    if (w <= h) return `[~1:${cleanRatioNumber(h / w)}]`;
                    return `[~${cleanRatioNumber(w / h)}:1]`;
                };

                node.updateResLabelTextRef = () => {
                    if (!node.resLabelRef) return;
                    if (!node.imgTagRef || !node.imgTagRef.naturalWidth) {
                        node.resLabelRef.innerText = "";
                        return;
                    }
                    const cw = node.imgTagRef.naturalWidth;
                    const ch = node.imgTagRef.naturalHeight;
                    const mode = widgets.mode ? widgets.mode.value : "Base";
                    
                    if (mode === "Base") {
                        node.resLabelRef.innerText = `${cw} x ${ch}`;
                        node.resLabelRef.style.cssText = "position: absolute; left: 0; right: 0; top: 0; bottom: 0; margin: auto; height: max-content; width: max-content; font-size: 10px; color: #d8d8dc; font-family: monospace; user-select: none; pointer-events: none; z-index: 5; text-align: center;";
                    } else if (mode === "Resize") {
                        const enableWgt = findW("enable_resize");
                        const isEnabled = enableWgt && enableWgt.value;
                        let nw = cw, nh = ch;
                        if (isEnabled) {
                            const kpWgt = findW("keep_proportion");
                            const kp = kpWgt ? kpWgt.value : "resize";
                            const conditionWgt = findW("condition");
                            const condition = conditionWgt ? conditionWgt.value : "always";
                            const divWgt = findW("divisible_by");
                            const divisible_by = divWgt ? parseInt(divWgt.value) : 2;

                            if (kp === "pad_for_outpainting") {
                                const pl = findW("pad_left") ? parseInt(findW("pad_left").value) : 0;
                                const pt = findW("pad_top") ? parseInt(findW("pad_top").value) : 0;
                                let pr = findW("pad_right") ? parseInt(findW("pad_right").value) : 0;
                                let pb = findW("pad_bottom") ? parseInt(findW("pad_bottom").value) : 0;
                                
                                nw = cw + pl + pr;
                                nh = ch + pt + pb;

                                if (divisible_by > 1) {
                                    const rem_w = nw % divisible_by;
                                    if (rem_w !== 0) {
                                        pr += divisible_by - rem_w;
                                        nw += divisible_by - rem_w;
                                    }
                                    const rem_h = nh % divisible_by;
                                    if (rem_h !== 0) {
                                        pb += divisible_by - rem_h;
                                        nh += divisible_by - rem_h;
                                    }
                                }
                            } else {
                                const wWgt = findW("width");
                                const hWgt = findW("height");
                                let target_w = wWgt ? parseInt(wWgt.value) : cw;
                                let target_h = hWgt ? parseInt(hWgt.value) : ch;
                                
                                let new_w = target_w;
                                let new_h = target_h;

                                if (kp === "scale_by") {
                                    const scaleWgt = findW("scale_by");
                                    let scale = scaleWgt ? parseFloat(scaleWgt.value) : 1;
                                    if (!Number.isFinite(scale)) scale = 1;
                                    scale = Math.max(0.01, Math.min(64, scale));
                                    target_w = Math.max(1, Math.round(cw * scale));
                                    target_h = Math.max(1, Math.round(ch * scale));
                                    new_w = target_w;
                                    new_h = target_h;
                                } else if (kp === "resize" || kp === "pad" || kp === "pad_edge_pixel") {
                                    const ratio = Math.min(target_w / cw, target_h / ch);
                                    new_w = Math.max(1, Math.round(cw * ratio));
                                    new_h = Math.max(1, Math.round(ch * ratio));
                                } else if (kp === "crop") {
                                    const ratio = Math.max(target_w / cw, target_h / ch);
                                    new_w = Math.max(1, Math.round(cw * ratio));
                                    new_h = Math.max(1, Math.round(ch * ratio));
                                }

                                let do_resize = true;
                                if (kp !== "scale_by") {
                                    if (condition === "downscale if bigger" && cw <= new_w && ch <= new_h) do_resize = false;
                                    else if (condition === "upscale if smaller" && cw >= new_w && ch >= new_h) do_resize = false;
                                    else if (condition === "if bigger area" && (cw * ch) <= (new_w * new_h)) do_resize = false;
                                    else if (condition === "if smaller area" && (cw * ch) >= (new_w * new_h)) do_resize = false;
                                }

                                if (do_resize) {
                                    if (kp === "stretch" || kp === "resize" || kp === "scale_by") {
                                        nw = new_w; nh = new_h;
                                    } else {
                                        nw = target_w; nh = target_h;
                                    }
                                } else {
                                    nw = cw; nh = ch;
                                }

                                if (divisible_by > 1 && (nw % divisible_by !== 0 || nh % divisible_by !== 0)) {
                                    const x = Math.floor((nw % divisible_by) / 2);
                                    const y = Math.floor((nh % divisible_by) / 2);
                                    const x2 = nw - ((nw % divisible_by) - x);
                                    const y2 = nh - ((nh % divisible_by) - y);
                                    nw = x2 - x;
                                    nh = y2 - y;
                                }
                            }
                            node.resLabelRef.innerHTML = `${formatAspect(cw, ch)}&nbsp; ${cw} x ${ch} &rarr; ${nw} x ${nh} &nbsp;${formatAspect(nw, nh)}`;
                        } else {
                            node.resLabelRef.innerHTML = `${formatAspect(cw, ch)}&nbsp; ${cw} x ${ch} &rarr; ${cw} x ${ch} &nbsp;${formatAspect(cw, ch)}`;
                        }
                        node.resLabelRef.style.cssText = "position: absolute; left: 0; right: 0; top: 0; bottom: 0; margin: auto; height: max-content; width: max-content; font-size: 10px; color: #f0f0f2; font-family: monospace; user-select: none; pointer-events: none; z-index: 5; padding: 0 6px; display: flex; align-items: center; justify-content: center; text-align: center;";
                    } else {
                        node.resLabelRef.innerText = "";
                        node.resLabelRef.style.display = "none";
                    }
                };

                node.syncHTMLRef = () => {
                    if (!node.widgets) return;
                    const getW = (name) => node.widgets.find(w => w && w.name === name);
                    
                    const wEnableResize = getW("enable_resize");
                    if (wEnableResize && node._checkboxEnableResize) {
                        node._checkboxEnableResize.checked = !!wEnableResize.value;
                        node._trackEnableResize.style.backgroundColor = wEnableResize.value ? "rgb(246, 103, 68)" : "#111";
                        node._circleEnableResize.style.transform = wEnableResize.value ? "translateX(16px)" : "translateX(0)";
                    }

                    const wCREnable = getW("cr_enable");
                    if (wCREnable && node._checkboxCREnable) {
                        node._checkboxCREnable.checked = !!wCREnable.value;
                        node._trackCREnable.style.backgroundColor = wCREnable.value ? "rgb(246, 103, 68)" : "#111";
                        node._circleCREnable.style.transform = wCREnable.value ? "translateX(16px)" : "translateX(0)";
                    }

                    const syncInput = (name, htmlInput, htmlSlider) => {
                        const w = getW(name);
                        if (w && w.value !== undefined) {
                            if (htmlInput) htmlInput.value = w.value;
                            if (htmlSlider) htmlSlider.value = w.value;
                        }
                    };
                    
                    syncInput("width", node._inputWidth, node._sliderWidth);
                    syncInput("height", node._inputHeight, node._sliderHeight);
                    syncInput("pad_left", node._inputPadLeft, node._sliderPadLeft);
                    syncInput("pad_top", node._inputPadTop, node._sliderPadTop);
                    syncInput("pad_right", node._inputPadRight, node._sliderPadRight);
                    syncInput("pad_bottom", node._inputPadBottom, node._sliderPadBottom);
                    syncInput("feathering", node._inputFeathering, node._sliderFeathering);
                    syncInput("divisible_by", node._inputDivisibleBy, node._sliderDivisibleBy);

                    const syncSelect = (name, htmlSelect) => {
                        const w = getW(name);
                        if (w && w.value !== undefined && htmlSelect) {
                            htmlSelect.value = String(w.value);
                        }
                    };

                    syncSelect("upscale_method", node._selectUpscaleMethod);
                    syncSelect("keep_proportion", node._selectKeepProportion);
                    syncSelect("condition", node._selectCondition);

                    node._syncHTMLWithWidgets.forEach(fn => fn());
                };

                const wrapper = document.createElement("div"); node.wrapperRef = wrapper; 
                wrapper.style.cssText = `position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; background: transparent; box-sizing: border-box; padding: 4px 0px; gap: 4px; pointer-events: auto; user-select: none; -webkit-user-select: none; overflow: visible;`;
                const applyNodeDomSideOutline = () => {
                    wrapper.style.border = "none";
                    wrapper.style.outline = "none";
                    wrapper.style.boxShadow = "none";
                };
                applyNodeDomSideOutline();

                const setDropActive = (active) => {
                    if (node._trixDropActive === active) return;
                    node._trixDropActive = active;
                    applyNodeDomSideOutline();
                    if (filePanel) filePanel.style.boxShadow = "none";
                    if (app.graph) app.graph.setDirtyCanvas(true, true);
                };

                const blockInFullscreen = (e) => { if (node.isFullscreen) { e.stopPropagation(); if (e.type === "contextmenu") e.preventDefault(); } };
                const blockedEvents = ["pointerup", "pointermove", "mousedown", "mouseup", "mousemove", "click", "dblclick", "contextmenu"];
                blockedEvents.forEach(evt => wrapper.addEventListener(evt, blockInFullscreen, { passive: false }));

                wrapper.addEventListener("wheel", (e) => {
                    if (node.isFullscreen) {
                        e.preventDefault(); e.stopPropagation();
                        const oldZoom = node._fsZoom; let zoomFactor = e.deltaY > 0 ? 0.9 : 1.1; 
                        node._fsZoom = Math.max(1.0, Math.min(node._fsZoom * zoomFactor, 20.0));
                        zoomFactor = node._fsZoom / oldZoom; 
                        if (zoomFactor !== 1.0) {
                            const rect = maskCanvas.getBoundingClientRect();
                            node._fsPanX -= (e.clientX - rect.left) * (zoomFactor - 1); node._fsPanY -= (e.clientY - rect.top) * (zoomFactor - 1);
                            if (node._fsZoom === 1.0) { node._fsPanX = 0; node._fsPanY = 0; }
                            applyZoomPan();
                        }
                        return;
                    } 
                    
                    const rp = e.target.closest(".trix-resize-panel");
                    if (rp) {
                        const isScrollable = rp.scrollHeight > rp.clientHeight;
                        if (isScrollable) {
                            const atTop = rp.scrollTop <= 0 && e.deltaY < 0;
                            const atBottom = Math.ceil(rp.scrollTop + rp.clientHeight) >= rp.scrollHeight && e.deltaY > 0;
                            if (!atTop && !atBottom) {
                                e.stopPropagation(); 
                                return; 
                            }
                        }
                    }

                    if (app.canvas) app.canvas.processMouseWheel(e);
                    e.preventDefault(); 
                    e.stopPropagation();
                }, { passive: false });

                let isCustomNodeDragging = false;
                let customDragStartNodePos = [0, 0];
                let customDragStartMousePos = [0, 0];

                wrapper.addEventListener("pointerdown", (e) => {
                    if (node.isFullscreen) return;

                    const targetTag = e.target.tagName.toUpperCase();
                    const isInteractive = ["BUTTON", "INPUT", "SELECT", "OPTION", "LABEL"].includes(targetTag) || e.target.closest("button") || e.target.closest("label") || e.target.id === "colorPick";
                    const isScrollbar = e.target.clientWidth > 0 && (e.offsetX >= e.target.clientWidth || e.offsetY >= e.target.clientHeight);

                    if (isInteractive || isScrollbar) return; 

                    const mode = widgets.mode ? widgets.mode.value : "Base";

                    if (mode === "Mask" && (e.target === maskCanvas || e.target === imgTag)) {
                        return; 
                    }

                    if ((mode === "Base" || mode === "Resize") && e.button === 0 && !e.altKey && !e.ctrlKey && !e.shiftKey) {
                        isCustomNodeDragging = true;
                        customDragStartNodePos = [...node.pos];
                        customDragStartMousePos = [e.clientX, e.clientY];

                        if (app.canvas && !node.isSelected) {
                            app.canvas.selectNode(node);
                        }

                        try { wrapper.setPointerCapture(e.pointerId); } catch (err) {}
                        e.preventDefault();
                        e.stopPropagation();
                    } else {
                        if (targetTag !== "CANVAS" && app.canvas) {
                            app.canvas.processMouseDown(e);
                        }
                    }
                });

                wrapper.addEventListener("pointermove", (e) => {
                    if (isCustomNodeDragging) {
                        const zoom = app.canvas.ds ? app.canvas.ds.scale : 1;
                        const dx = (e.clientX - customDragStartMousePos[0]) / zoom;
                        const dy = (e.clientY - customDragStartMousePos[1]) / zoom;

                        node.pos[0] = customDragStartNodePos[0] + dx;
                        node.pos[1] = customDragStartNodePos[1] + dy;

                        if (node.requestDirtyCanvas) node.requestDirtyCanvas();
                        e.preventDefault();
                        e.stopPropagation();
                    }
                });

                wrapper.addEventListener("pointerup", (e) => {
                    if (isCustomNodeDragging) {
                        isCustomNodeDragging = false;
                        try { wrapper.releasePointerCapture(e.pointerId); } catch (err) {}
                        if (app.graph) app.graph.setDirtyCanvas(true, true);
                        e.preventDefault();
                        e.stopPropagation();
                    }
                });

                const headerContainer = document.createElement("div");
                headerContainer.style.cssText = `display: flex; flex-direction: column; width: 100%; pointer-events: auto; z-index: 10; margin-top: ${TRIX_HEADER_OFFSET_Y}px; box-sizing: border-box; background: ${TRIX_BG};`;
                node.headerContainerRef = headerContainer;

                const imageChoices = () => {
                    const w = widgets.image;
                    const values = [];
                    if (w && w.options && Array.isArray(w.options.values)) {
                        values.push(...w.options.values);
                    }
                    if (w && w.value && !values.includes(w.value)) values.unshift(w.value);
                    return values;
                };

                const setImageWidgetValue = (value, markChanging = true) => {
                    if (!value || !widgets.image) return;
                    if (markChanging && node.maskCanvasRef && node.maskCanvasRef.width > 0 && widgets.mask_data) {
                        widgets.mask_data.value = node.maskCanvasRef.toDataURL();
                    }
                    if (markChanging) node._isChangingImage = true;
                    widgets.image.value = value;
                    if (widgets.image.options && Array.isArray(widgets.image.options.values) && !widgets.image.options.values.includes(value)) {
                        widgets.image.options.values.unshift(value);
                    }
                    if (widgets.image.callback) widgets.image.callback(value);
                    if (node.refreshImagePickerRef) node.refreshImagePickerRef();
                };

                const uploadImageFile = async (file) => {
                    if (!file || !file.type || !file.type.startsWith("image/")) return false;
                    const body = new FormData();
                    body.append("image", file, file.name || `image${trixImageExt("", file.type)}`);
                    body.append("type", "input");
                    try {
                        if (node._uploadBtnRef) {
                            node._uploadBtnRef.disabled = true;
                            node._uploadBtnRef.querySelector("span").textContent = "Uploading...";
                        }
                        const resp = await fetch("/upload/image", { method: "POST", body });
                        if (resp.status !== 200) throw new Error(`Upload failed: ${resp.status}`);
                        const data = await resp.json();
                        const finalName = trixDefaultUploadFullPath(data);
                        setImageWidgetValue(finalName);
                        return true;
                    } catch (err) {
                        console.error("TrixLoader Upload Error:", err);
                        alert("Failed to upload image: " + err);
                        return false;
                    } finally {
                        if (node._uploadBtnRef) {
                            node._uploadBtnRef.disabled = false;
                            node._uploadBtnRef.querySelector("span").textContent = "Upload Image";
                        }
                    }
                };
                node.uploadImageFileRef = uploadImageFile;

                const filePanel = document.createElement("div");
                filePanel.className = "trix-file-panel";
                filePanel.style.cssText = `display: flex; flex-direction: column; gap: 6px; width: 100%; background: ${TRIX_BG}; padding: 4px 6px; box-sizing: border-box; border-radius: 6px 6px 0 0; border-bottom: 1px solid ${TRIX_CONTROL}; position: relative; isolation: isolate;`;

                const filePanelTopShield = document.createElement("div");
                filePanelTopShield.style.cssText = `position: absolute; left: 0; right: 0; top: -4px; height: 4px; background: ${TRIX_BG}; border-radius: 6px 6px 0 0; pointer-events: none; z-index: 0;`;

                const pickerRow = document.createElement("div");
                pickerRow.style.cssText = "display: grid; grid-template-columns: 24px minmax(0, 1fr) 24px; gap: 4px; align-items: center; width: 100%; position: relative; z-index: 1;";

                const pickerBtnStyle = `height: 22px; border: 1px solid ${TRIX_BORDER}; border-radius: 5px; background: ${TRIX_CONTROL}; color: ${TRIX_TEXT}; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; line-height: 1; transition: 0.15s;`;
                const prevImageBtn = document.createElement("button");
                prevImageBtn.innerHTML = svgChevronLeft;
                prevImageBtn.title = "Previous image";
                prevImageBtn.style.cssText = pickerBtnStyle;
                const nextImageBtn = document.createElement("button");
                nextImageBtn.innerHTML = svgChevronRight;
                nextImageBtn.title = "Next image";
                nextImageBtn.style.cssText = pickerBtnStyle;

                const imageSelect = document.createElement("select");
                imageSelect.title = "Selected image";
                imageSelect.style.cssText = `height: 22px; width: 100%; min-width: 0; background: ${TRIX_CONTROL}; color: ${TRIX_TEXT}; border: 1px solid ${TRIX_BORDER}; border-radius: 5px; padding: 0 8px; font-size: 11px; font-family: var(--comfy-font-family, sans-serif); outline: none; cursor: pointer; box-sizing: border-box;`;

                const uploadRow = document.createElement("div");
                uploadRow.style.cssText = "display: grid; grid-template-columns: 1fr; width: 100%; position: relative; z-index: 1;";

                const uploadBtn = document.createElement("button");
                uploadBtn.innerHTML = `${svgUpload}<span>Upload Image</span>`;
                uploadBtn.style.cssText = `height: 20px; width: 100%; background: ${TRIX_ACCENT}; color: #fff; border: 1px solid rgba(255,255,255,0.12); border-radius: 5px; cursor: pointer; font-size: 10.5px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.35); transition: 0.15s ease;`;
                uploadBtn.onmouseenter = () => { uploadBtn.style.background = TRIX_ACCENT_HOVER; };
                uploadBtn.onmouseleave = () => { uploadBtn.style.background = TRIX_ACCENT; };
                node._uploadBtnRef = uploadBtn;

                const fileInput = document.createElement("input");
                fileInput.type = "file";
                fileInput.accept = "image/*";
                fileInput.style.display = "none";

                const refreshImagePicker = () => {
                    const current = widgets.image ? widgets.image.value : "";
                    const values = imageChoices();
                    imageSelect.innerHTML = "";
                    if (values.length === 0) {
                        const opt = document.createElement("option");
                        opt.value = "";
                        opt.textContent = "No image selected";
                        imageSelect.appendChild(opt);
                    } else {
                        values.forEach((value) => {
                            const opt = document.createElement("option");
                            opt.value = value;
                            opt.textContent = value;
                            imageSelect.appendChild(opt);
                        });
                    }
                    if (current) {
                        if (![...imageSelect.options].some((opt) => opt.value === current)) {
                            const opt = document.createElement("option");
                            opt.value = current;
                            opt.textContent = current;
                            imageSelect.insertBefore(opt, imageSelect.firstChild);
                        }
                        imageSelect.value = current;
                    }
                };
                node.refreshImagePickerRef = refreshImagePicker;

                const stepImage = (dir) => {
                    const values = imageChoices();
                    if (!values.length || !widgets.image) return;
                    const currentIdx = Math.max(0, values.indexOf(widgets.image.value));
                    const nextIdx = (currentIdx + dir + values.length) % values.length;
                    setImageWidgetValue(values[nextIdx]);
                };

                prevImageBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); stepImage(-1); };
                nextImageBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); stepImage(1); };
                imageSelect.onchange = () => setImageWidgetValue(imageSelect.value);
                uploadBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); fileInput.click(); };
                fileInput.onchange = async () => {
                    const file = fileInput.files && fileInput.files[0];
                    if (file) await uploadImageFile(file);
                    fileInput.value = "";
                };

                pickerRow.append(prevImageBtn, imageSelect, nextImageBtn);
                uploadRow.append(uploadBtn, fileInput);
                filePanel.append(filePanelTopShield, pickerRow, uploadRow);
                headerContainer.appendChild(filePanel);

                const hasImageDrag = (event) => {
                    const dt = event.dataTransfer;
                    if (!dt) return false;
                    if (dt.items && Array.from(dt.items).some((item) => item.kind === "file" && (!item.type || item.type.startsWith("image/")))) return true;
                    if (dt.types && Array.from(dt.types).includes("Files")) return true;
                    return false;
                };

                const getImageDropFile = (event) => {
                    const dt = event.dataTransfer;
                    const files = dt && dt.files ? Array.from(dt.files) : [];
                    const fileFromList = files.find((file) => file && file.type && file.type.startsWith("image/"));
                    if (fileFromList) return fileFromList;
                    const items = dt && dt.items ? Array.from(dt.items) : [];
                    for (const item of items) {
                        if (item.kind !== "file") continue;
                        const file = item.getAsFile ? item.getAsFile() : null;
                        if (file && file.type && file.type.startsWith("image/")) return file;
                    }
                    return null;
                };

                const getEventCanvasPos = (event) => {
                    if (app.canvas && typeof app.canvas.convertEventToCanvasOffset === "function") {
                        return app.canvas.convertEventToCanvasOffset(event);
                    }

                    const canvasEl = app.canvas && app.canvas.canvas;
                    const rect = canvasEl && canvasEl.getBoundingClientRect ? canvasEl.getBoundingClientRect() : null;
                    const ds = app.canvas && app.canvas.ds;
                    const scale = ds && ds.scale ? ds.scale : 1;
                    const offset = ds && ds.offset ? ds.offset : [0, 0];
                    if (!rect) return null;
                    return [
                        (event.clientX - rect.left) / scale - offset[0],
                        (event.clientY - rect.top) / scale - offset[1]
                    ];
                };

                const isEventOverThisNode = (event) => {
                    const wrapperRect = wrapper.getBoundingClientRect();
                    if (
                        event.clientX >= wrapperRect.left &&
                        event.clientX <= wrapperRect.right &&
                        event.clientY >= wrapperRect.top &&
                        event.clientY <= wrapperRect.bottom
                    ) {
                        return true;
                    }

                    const graphPos = getEventCanvasPos(event);
                    if (!graphPos || !node.pos || !node.size) return false;
                    const titleHeight = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_TITLE_HEIGHT) ? LiteGraph.NODE_TITLE_HEIGHT : 30;
                    const pad = 8;
                    return (
                        graphPos[0] >= node.pos[0] - pad &&
                        graphPos[0] <= node.pos[0] + node.size[0] + pad &&
                        graphPos[1] >= node.pos[1] - titleHeight - pad &&
                        graphPos[1] <= node.pos[1] + node.size[1] + pad
                    );
                };

                ["dragenter", "dragover"].forEach((evtName) => {
                    wrapper.addEventListener(evtName, (e) => {
                        if (!hasImageDrag(e)) return;
                        e.preventDefault();
                        e.stopPropagation();
                        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
                        setDropActive(true);
                    }, { passive: false });
                });

                wrapper.addEventListener("dragleave", (e) => {
                    if (!wrapper.contains(e.relatedTarget)) setDropActive(false);
                });

                wrapper.addEventListener("drop", async (e) => {
                    const file = getImageDropFile(e);
                    if (!file) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setDropActive(false);
                    await uploadImageFile(file);
                }, { passive: false });

                const documentDragOverHandler = (e) => {
                    if (!hasImageDrag(e) || !isEventOverThisNode(e)) {
                        if (node._trixDropActive) setDropActive(false);
                        return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
                    setDropActive(true);
                };

                const documentDropHandler = async (e) => {
                    if (!isEventOverThisNode(e)) {
                        if (node._trixDropActive) setDropActive(false);
                        return;
                    }
                    const file = getImageDropFile(e);
                    if (!file) {
                        setDropActive(false);
                        return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    setDropActive(false);
                    await uploadImageFile(file);
                };

                document.addEventListener("dragover", documentDragOverHandler, { capture: true, passive: false });
                document.addEventListener("drop", documentDropHandler, { capture: true, passive: false });

                node.onDropFile = (file) => {
                    if (!file || !file.type || !file.type.startsWith("image/")) return false;
                    setDropActive(false);
                    uploadImageFile(file);
                    return true;
                };

                const tabs = document.createElement("div");
                tabs.style.cssText = `display: flex; gap: 4px; width: 100%; height: 22px; background: ${TRIX_PANEL_SOFT}; border-radius: 0; padding: 2px 6px; box-sizing: border-box; align-items: center;`;
                const btnRef = {};
                
                let clickTimer = null; 
                
                ["Base", "Mask", "Resize"].forEach(m => {
                    const btn = document.createElement("button"); btn.innerText = m.toUpperCase();
                    btn.style.cssText = "flex: 1; margin: 0; cursor: pointer; background: rgba(255, 255, 255, 0.1); color: #fff; border: 1px solid transparent; border-radius: 4px; font-size: 10px; font-weight: 500; transition: 0.15s ease-in-out; display: flex; align-items: center; justify-content: center; text-align: center; white-space: nowrap; overflow: hidden; height: 100%; box-sizing: border-box; text-shadow: 0 1px 1px rgba(0,0,0,0.5);";
                    
                    btn.onmouseenter = () => { 
                        const isEnableResize = (widgets.enable_resize && widgets.enable_resize.value);
                        const isCrEnabled = (widgets.cr_enable && widgets.cr_enable.value);
                        if(widgets.mode && widgets.mode.value !== m) {
                            if (m === "Resize" && isEnableResize) {
                                btn.style.background = "rgb(255, 115, 80)";
                            } else if (m === "Base" && isCrEnabled) {
                                btn.style.background = "rgb(255, 115, 80)";
                            } else {
                                btn.style.background = "rgba(255, 255, 255, 0.4)";
                            }
                        }
                    };
                    btn.onmouseleave = () => { 
                        const isEnableResize = (widgets.enable_resize && widgets.enable_resize.value);
                        const isCrEnabled = (widgets.cr_enable && widgets.cr_enable.value);
                        if(widgets.mode && widgets.mode.value !== m) {
                            if (m === "Resize" && isEnableResize) {
                                btn.style.background = "rgb(246, 103, 68)";
                            } else if (m === "Base" && isCrEnabled) {
                                btn.style.background = "rgb(246, 103, 68)";
                            } else {
                                btn.style.background = "rgba(255, 255, 255, 0.2)";
                            }
                        }
                    };

                    btn.onclick = (e) => { 
                        e.preventDefault(); e.stopPropagation();
                        const currentMode = widgets.mode ? widgets.mode.value : "Main";
                        if (currentMode !== m) { 
                            if (widgets.mode) widgets.mode.value = m; 
                            if (!node.isFullscreen) node.isPreviewHidden = false; 
                            node._isToolbarHidden = false; 
                            updateUI(); 
                        } else {
                            if (m === "Mask") {
                                if (clickTimer) clearTimeout(clickTimer);
                                clickTimer = setTimeout(() => {
                                    node._isToolbarHidden = !node._isToolbarHidden;
                                    updateUI();
                                    clickTimer = null;
                                }, 220); 
                            }
                        }
                    };
                    
                    btn.ondblclick = (e) => {
                        e.preventDefault(); e.stopPropagation();
                        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
                        
                        if (widgets.mode && widgets.mode.value === m) {
                            if (m === "Mask") {
                                node.isFullscreen = !node.isFullscreen; 
                                if (node.applyZoomPanRef) node.applyZoomPanRef();
                                updateUI();
                            } else if (m === "Base") {
                                node._showCameraRawMenu = !node._showCameraRawMenu;
                                updateUI();
                                if (app.graph) app.graph.setDirtyCanvas(true, true);
                            }
                        }
                    };
                    tabs.appendChild(btn); btnRef[m] = btn;
                });

                const toolBar = document.createElement("div");
                const TOOLBAR_HEIGHT_BASE_MASK = 26;
                const TOOLBAR_HEIGHT_RESIZE = 26;
                const TOOLBAR_BG_DARK = TRIX_PANEL_SOFT;
                const TOOLBAR_BG_LIGHT = TRIX_PANEL_SOFT;
                toolBar.style.cssText = `display: grid; grid-template-columns: minmax(30px, 1fr) auto auto auto auto auto auto; gap: 4px; align-items: center; background: ${TRIX_PANEL_SOFT}; padding: 1px 6px 2px 6px; border: none; border-radius: 0; width: 100%; min-height: 26px; height: auto; box-sizing: border-box; overflow: hidden; position: relative;`;

                
                const slidersContainer = document.createElement("div");
                slidersContainer.style.cssText = "display: flex; flex-direction: column; width: 100%; justify-content: center; gap: 2px; padding: 0; min-width: 0; overflow: hidden;";

                const createSliderRow = (min, max, val, title, isHardness=false) => {
                    const wrap = document.createElement("div");
                    wrap.style.cssText = "display: flex; align-items: center; gap: 4px; width: 100%; overflow: hidden;";
                    
                    const slider = document.createElement("input"); 
                    slider.type = "range"; slider.min = min; slider.max = max; slider.value = val; 
                    slider.style.cssText = `flex: 1; cursor: pointer; min-width: 10px; width: 100%; margin: 0; accent-color: ${TRIX_ACCENT};`; slider.title = title;
                    
                    const num = document.createElement("input");
                    num.type = "number"; num.min = min; num.max = max; num.value = val;
                    num.style.cssText = "width: 38px; background: rgba(0,0,0,0.5); border: 1px solid rgba(68,68,68,0.5); color: #fff; font-size: 10px; border-radius: 3px; text-align: center; display: none; box-sizing: border-box; flex-shrink: 0;";
                    
                    slider.addEventListener("mousedown", (e) => e.stopPropagation()); 
                    slider.addEventListener("pointerdown", (e) => e.stopPropagation());
                    num.addEventListener("mousedown", (e) => e.stopPropagation()); 
                    num.addEventListener("pointerdown", (e) => e.stopPropagation());

                    wrap.append(slider, num);
                    return {wrap, slider, num};
                };

                const brushRow = createSliderRow(1, 250, 100, "Brush Size");
                const slider = brushRow.slider;
                node._sizeNum = brushRow.num;
                
                const hardnessRow = createSliderRow(0, 100, 100, "Brush Hardness", true);
                const hardnessSlider = hardnessRow.slider;
                node._hardnessNum = hardnessRow.num;
                hardnessRow.wrap.style.display = "none"; 

                slider.oninput = (e) => { node.brushSize = e.target.value; node._sizeNum.value = e.target.value; updateCursorSize(); };
                node._sizeNum.oninput = (e) => { let v = Math.max(1, Math.min(250, e.target.value||100)); node.brushSize = v; slider.value = v; updateCursorSize(); };

                hardnessSlider.oninput = (e) => { node.brushHardness = e.target.value / 100; node._hardnessNum.value = e.target.value; updateCursorSize(); };
                node._hardnessNum.oninput = (e) => { let v = Math.max(0, Math.min(100, e.target.value||100)); node.brushHardness = v / 100; hardnessSlider.value = v; updateCursorSize(); };

                slidersContainer.append(brushRow.wrap, hardnessRow.wrap);

                const colorPick = document.createElement("div"); colorPick.id = "colorPick";
                const colors = ["#00FF00", "#FF0000", "#FFFFFF", "#000000"]; let colorIdx = 1; node.maskColor = colors[colorIdx];
                colorPick.style.cssText = `width: 18px; height: 18px; border: 2px solid #555; border-radius: 50%; background-color: ${colors[colorIdx]}; cursor: pointer; flex-shrink: 0; box-sizing: border-box;`;
                colorPick.onclick = () => { colorIdx = (colorIdx + 1) % colors.length; node.maskColor = colors[colorIdx]; colorPick.style.backgroundColor = node.maskColor; };

                const ICON_SIZE = "16.5px"; 
                const iconStyle = `width:${ICON_SIZE}; height:${ICON_SIZE}; position:absolute; pointer-events:none;`;

                const createBtn = (iconSvg, hint) => {
                    const b = document.createElement("button"); b.innerHTML = iconSvg; b.title = hint;
                    b.style.cssText = "position: relative; overflow: visible; background: rgba(42, 42, 47, 0.65); color: #ccc; border: 1px solid rgba(68, 68, 68, 0.5); border-radius: 4px; width: 18px; height: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; user-select: none; transition: 0.1s; flex-shrink: 0;";
                    b.onmouseenter = () => { b.style.background = "rgba(58, 58, 64, 0.8)"; }; b.onmouseleave = () => { b.style.background = "rgba(42, 42, 47, 0.65)"; }; return b;
                };

                const svgEyeMask = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="${iconStyle}"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
                const svgUndoMask = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="${iconStyle}"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>`;
                const svgRedoMask = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="${iconStyle}"><polyline points="15 14 20 9 15 4"></polyline><path d="M4 20v-7a4 4 0 0 1 4-4h12"></path></svg>`;
                const svgEraserMask = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="${iconStyle}"><path d="M20 20H7L3 16C2.5 15.5 2.5 14.5 3 14L13 4C13.5 3.5 14.5 3.5 15 4L20 9C20.5 9.5 20.5 10.5 20 11L11 20H20V20Z"></path><line x1="17" y1="14" x2="10" y2="7"></line></svg>`;
                const svgClearMask = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="${iconStyle}"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;

                const toggleMaskBtn = createBtn(svgEyeMask, "Hold to hide mask");
                toggleMaskBtn.onpointerdown = (e) => { node._isMaskHidden = true; if (node.isFullscreen) maskCanvas.style.opacity = "0"; if (app.graph) app.graph.setDirtyCanvas(true, true); };
                const restoreMask = () => { if (!node._isMaskHidden) return; node._isMaskHidden = false; if (node.isFullscreen) maskCanvas.style.opacity = "0.8"; if (app.graph) app.graph.setDirtyCanvas(true, true); };
                toggleMaskBtn.onpointerup = restoreMask; toggleMaskBtn.onpointerleave = restoreMask;

                const undoBtn = createBtn(svgUndoMask, "Undo"); 
                const redoBtn = createBtn(svgRedoMask, "Redo"); 
                const eraserBtn = createBtn(svgEraserMask, "Eraser"); 
                const clearBtn = createBtn(svgClearMask, "Clear");

                eraserBtn.onmouseenter = () => { eraserBtn.style.background = node.isEraser ? "#3f8eb4" : "rgba(58, 58, 64, 0.8)"; }; 
                eraserBtn.onmouseleave = () => { eraserBtn.style.background = node.isEraser ? "#33789a" : "rgba(42, 42, 47, 0.65)"; };
                eraserBtn.onclick = () => { node.isEraser = !node.isEraser; eraserBtn.style.background = node.isEraser ? "#33789a" : "rgba(42, 42, 47, 0.65)"; eraserBtn.style.color = node.isEraser ? "#fff" : "#ccc"; };

                toolBar.append(slidersContainer, colorPick, toggleMaskBtn, undoBtn, redoBtn, eraserBtn, clearBtn);
                headerContainer.append(tabs, toolBar);

                const getW = (name) => node.widgets ? node.widgets.find(w => w && w.name === name) : undefined;
                
                const resizePanel = document.createElement("div");
                resizePanel.className = "trix-resize-panel";
                resizePanel.style.cssText = `display: none; flex-direction: column; width: 100%; height: 100%; padding: 4px 8px; box-sizing: border-box; overflow-y: auto; overflow-x: hidden; pointer-events: auto; background: ${TRIX_PANEL_SOFT}; min-height: 0; border-radius: 0 0 6px 6px;`;

                if (!document.getElementById("trix-clean-inputs")) {
                    const style = document.createElement("style");
                    style.id = "trix-clean-inputs";
                    style.innerHTML = `
                        input.trix-num::-webkit-inner-spin-button, input.trix-num::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; } 
                        input.trix-num { -moz-appearance: textfield; }
                        .trix-resize-panel::-webkit-scrollbar { width: 6px; }
                        .trix-resize-panel::-webkit-scrollbar-track { background: transparent; }
                        .trix-resize-panel::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }
                        .trix-resize-panel::-webkit-scrollbar-thumb:hover { background: #666; }
                        .trix-cr-panel::-webkit-scrollbar { width: 6px; }
                        .trix-cr-panel::-webkit-scrollbar-track { background: transparent; }
                        .trix-cr-panel::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }
                        .trix-cr-panel::-webkit-scrollbar-thumb:hover { background: #666; }
                    `;
                    document.head.appendChild(style);
                }

                const createToggleRow = (label, wgtName) => {
                    const wgt = getW(wgtName);
                    const row = document.createElement("div");
                    row.style.cssText = `display: flex; flex-direction: row; align-items: center; justify-content: space-between; background: ${TRIX_CONTROL}; padding: 4px 8px; margin-bottom: 4px; border-radius: 4px; border: 1px solid ${TRIX_BORDER}; box-shadow: inset 0 1px 2px rgba(0,0,0,0.32); flex-shrink: 0; min-height: 26px;`;

                    const title = document.createElement("span");
                    title.innerText = label;
                    title.style.cssText = "color: #e0e0e0; font-family: var(--comfy-font-family, sans-serif); font-size: 11px; font-weight: 500; text-shadow: 1px 1px 1px #000;";

                    if (wgtName === "enable_resize" || wgtName === "cr_enable") {
                        title.style.fontWeight = "bold";
                    }

                    const switchContainer = document.createElement("label");
                    switchContainer.style.cssText = "position: relative; display: inline-block; width: 34px; height: 18px; margin: 0; cursor: pointer;";

                    const checkbox = document.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.style.cssText = "opacity: 0; width: 0; height: 0; position: absolute;";
                    checkbox.checked = wgt ? !!wgt.value : false;

                    const track = document.createElement("span");
                    track.style.cssText = "position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: " + (checkbox.checked ? "rgb(246, 103, 68)" : "#111") + "; transition: .2s; border-radius: 18px; border: 1px solid #444; box-sizing: border-box;";

                    const circle = document.createElement("span");
                    circle.style.cssText = "position: absolute; content: ''; height: 12px; width: 12px; left: 2px; top: 2px; background-color: white; transition: .2s; border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,0.5);" + (checkbox.checked ? " transform: translateX(16px);" : "");

                    track.appendChild(circle);
                    switchContainer.append(checkbox, track);

                    switchContainer.addEventListener("mousedown", (e) => e.stopPropagation());
                    switchContainer.addEventListener("pointerdown", (e) => e.stopPropagation());

                    checkbox.onchange = (e) => {
                        const val = e.target.checked;
                        if (wgt) wgt.value = val;
                        track.style.backgroundColor = val ? "rgb(246, 103, 68)" : "#111";
                        circle.style.transform = val ? "translateX(16px)" : "translateX(0)";
                        
                        if (app.graph) app.graph.setDirtyCanvas(true, true);
                        if (node.updateUIRef) node.updateUIRef(); 
                        if (wgtName !== "cr_enable" && node.updateDynamicVisibilityRef) node.updateDynamicVisibilityRef();
                    };

                    node._syncHTMLWithWidgets.push(() => {
                        if (wgt && wgt.value !== undefined) {
                            checkbox.checked = !!wgt.value;
                            track.style.backgroundColor = checkbox.checked ? "rgb(246, 103, 68)" : "#111";
                            circle.style.transform = checkbox.checked ? "translateX(16px)" : "translateX(0)";
                        }
                    });

                    if (wgtName === "enable_resize") {
                        node._checkboxEnableResize = checkbox;
                        node._trackEnableResize = track;
                        node._circleEnableResize = circle;
                    }
                    if (wgtName === "cr_enable") {
                        node._checkboxCREnable = checkbox;
                        node._trackCREnable = track;
                        node._circleCREnable = circle;
                    }

                    row.append(title, switchContainer);
                    return row;
                };

                const createInputRow = (label, wgtName, type, optionsOrMinMax) => {
                    const wgt = getW(wgtName); 
                    const row = document.createElement("div");
                    row.style.cssText = `display: flex; flex-direction: row; align-items: center; background: ${TRIX_CONTROL}; padding: 4px 8px; margin-bottom: 4px; border-radius: 4px; border: 1px solid ${TRIX_BORDER}; box-shadow: inset 0 1px 2px rgba(0,0,0,0.32); flex-shrink: 0; min-height: 26px;`;
                    
                    const title = document.createElement("span");
                    title.innerText = label;
                    title.style.cssText = "color: #e0e0e0; font-family: var(--comfy-font-family, sans-serif); font-size: 11px; font-weight: 500; text-shadow: 1px 1px 1px #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 0 0 95px;";
                    
                    row.append(title);

                    if (type === "select") {
                        const inputEl = document.createElement("select");
                        optionsOrMinMax.forEach(o => {
                            const opt = document.createElement("option");
                            opt.value = o; opt.innerText = o === "scale_by" ? "scale by" : o;
                            inputEl.appendChild(opt);
                        });
                        if (wgt && wgt.value !== undefined) inputEl.value = String(wgt.value);
                        inputEl.onchange = () => {
                            if (wgt) wgt.value = (typeof wgt.value === 'number') ? parseInt(inputEl.value) : inputEl.value;
                            if(app.graph) app.graph.setDirtyCanvas(true, true);
                            if(node.updateDynamicVisibilityRef) node.updateDynamicVisibilityRef();
                            if(node.updateResLabelTextRef) node.updateResLabelTextRef();
                        };
                        inputEl.style.cssText = "background: #000; color: #fff; border: 1px solid #444; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-family: var(--comfy-font-family, monospace); outline: none; flex: 1; min-width: 0; box-sizing: border-box; cursor: pointer;";
                        
                        node._syncHTMLWithWidgets.push(() => {
                            if (wgt && wgt.value !== undefined) {
                                inputEl.value = String(wgt.value);
                            }
                        });

                        if (wgtName === "upscale_method") node._selectUpscaleMethod = inputEl;
                        if (wgtName === "keep_proportion") node._selectKeepProportion = inputEl;
                        if (wgtName === "condition") node._selectCondition = inputEl;

                        row.append(inputEl);
                    } else {
                        const minVal = optionsOrMinMax[0]; 
                        const maxVal = optionsOrMinMax[1];
                        const defVal = optionsOrMinMax.length > 2 ? optionsOrMinMax[2] : minVal;
                        
                        let startVal = (wgt && wgt.value !== undefined && wgt.value !== null) ? parseInt(wgt.value) : defVal;
                        if(isNaN(startVal)) startVal = defVal;
                        
                        const sliderEl = document.createElement("input");
                        sliderEl.type = "range";
                        sliderEl.min = minVal;
                        sliderEl.max = maxVal;
                        sliderEl.value = startVal;
                        sliderEl.style.cssText = "flex: 1; margin: 0 8px; min-width: 40px; cursor: pointer; accent-color: #33789a;";
                        
                        const inputEl = document.createElement("input");
                        inputEl.type = "number";
                        inputEl.min = minVal; 
                        inputEl.max = maxVal;
                        inputEl.value = startVal;
                        inputEl.className = "trix-num";
                        inputEl.style.cssText = "background: #000; color: #fff; border: 1px solid #444; padding: 2px 4px; border-radius: 4px; font-size: 11px; font-family: var(--comfy-font-family, monospace); outline: none; width: 50px; box-sizing: border-box; cursor: pointer; text-align: right; flex-shrink: 0;";
                        
                        sliderEl.addEventListener("mousedown", (e) => e.stopPropagation());
                        sliderEl.addEventListener("pointerdown", (e) => e.stopPropagation());
                        inputEl.addEventListener("mousedown", (e) => e.stopPropagation());
                        inputEl.addEventListener("pointerdown", (e) => e.stopPropagation());
                        
                        const updateVals = (val) => {
                            let parsed = parseInt(val);
                            if(isNaN(parsed)) parsed = minVal;
                            parsed = Math.max(minVal, Math.min(maxVal, parsed));
                            inputEl.value = parsed;
                            sliderEl.value = parsed;
                            if (wgt) wgt.value = parsed;
                            if(app.graph) app.graph.setDirtyCanvas(true, true);
                            if(node.updateResLabelTextRef) node.updateResLabelTextRef();
                        };

                        inputEl.onchange = (e) => updateVals(e.target.value);
                        sliderEl.oninput = (e) => updateVals(e.target.value);
                        
                        const doReset = () => updateVals(defVal);
                        sliderEl.ondblclick = doReset;
                        title.ondblclick = doReset;
                        title.style.cursor = "pointer";

                        node._syncHTMLWithWidgets.push(() => {
                            if (wgt && wgt.value !== undefined && wgt.value !== null) {
                                let parsed = parseInt(wgt.value);
                                if (!isNaN(parsed)) {
                                    inputEl.value = parsed;
                                    sliderEl.value = parsed;
                                }
                            }
                        });

                        if (wgtName === "width") { node._inputWidth = inputEl; node._sliderWidth = sliderEl; }
                        if (wgtName === "height") { node._inputHeight = inputEl; node._sliderHeight = sliderEl; }
                        if (wgtName === "pad_left") { node._inputPadLeft = inputEl; node._sliderPadLeft = sliderEl; }
                        if (wgtName === "pad_top") { node._inputPadTop = inputEl; node._sliderPadTop = sliderEl; }
                        if (wgtName === "pad_right") { node._inputPadRight = inputEl; node._sliderPadRight = sliderEl; }
                        if (wgtName === "pad_bottom") { node._inputPadBottom = inputEl; node._sliderPadBottom = sliderEl; }
                        if (wgtName === "feathering") { node._inputFeathering = inputEl; node._sliderFeathering = sliderEl; }
                        if (wgtName === "divisible_by") { node._inputDivisibleBy = inputEl; node._sliderDivisibleBy = sliderEl; }

                        row.append(sliderEl, inputEl);
                    }
                    
                    return row;
                };

                const createScaleByRow = () => {
                    const wgt = getW("scale_by");
                    const row = document.createElement("div");
                    row.style.cssText = `display: none; flex-direction: column; gap: 6px; background: ${TRIX_CONTROL}; padding: 7px 8px; margin-bottom: 4px; border-radius: 4px; border: 1px solid ${TRIX_BORDER}; box-shadow: inset 0 1px 2px rgba(0,0,0,0.32); flex-shrink: 0;`;

                    const presetRow = document.createElement("div");
                    presetRow.style.cssText = "display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px;";

                    const customInput = document.createElement("input");
                    customInput.type = "number";
                    customInput.min = "0.01";
                    customInput.max = "64";
                    customInput.step = "0.01";
                    customInput.className = "trix-num";
                    customInput.style.cssText = `height: 24px; background: ${TRIX_BG}; color: ${TRIX_TEXT}; border: 1px solid ${TRIX_BORDER}; padding: 2px 8px; border-radius: 5px; font-size: 11px; font-family: var(--comfy-font-family, monospace); outline: none; width: 100%; box-sizing: border-box; cursor: pointer; text-align: center;`;

                    const normalizeScale = (val) => {
                        let parsed = parseFloat(val);
                        if (!Number.isFinite(parsed)) parsed = 1;
                        parsed = Math.max(0.01, Math.min(64, parsed));
                        return Math.round(parsed * 100) / 100;
                    };

                    const formatScale = (val) => {
                        const normalized = normalizeScale(val);
                        return Number.isInteger(normalized) ? String(normalized) : String(normalized).replace(/0+$/, "").replace(/\.$/, "");
                    };

                    const buttons = [];
                    const setScale = (value, silent = false) => {
                        const normalized = normalizeScale(value);
                        if (wgt) wgt.value = normalized;
                        customInput.value = formatScale(normalized);
                        buttons.forEach((btn) => {
                            const active = Math.abs(parseFloat(btn.dataset.scale) - normalized) < 0.001;
                            btn.style.background = active ? TRIX_ACCENT : TRIX_BG;
                            btn.style.color = active ? "#fff" : TRIX_TEXT;
                            btn.style.borderColor = active ? TRIX_ACCENT : TRIX_BORDER;
                        });
                        if (!silent && app.graph) app.graph.setDirtyCanvas(true, true);
                        if (!silent && node.updateResLabelTextRef) node.updateResLabelTextRef();
                    };

                    [0.25, 0.5, 2, 4].forEach((scale) => {
                        const btn = document.createElement("button");
                        btn.type = "button";
                        btn.dataset.scale = String(scale);
                        btn.textContent = `${scale}x`;
                        btn.style.cssText = `height: 24px; background: ${TRIX_BG}; color: ${TRIX_TEXT}; border: 1px solid ${TRIX_BORDER}; border-radius: 5px; cursor: pointer; font-size: 11px; font-weight: 700; transition: 0.15s;`;
                        btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); setScale(scale); };
                        buttons.push(btn);
                        presetRow.appendChild(btn);
                    });

                    customInput.onchange = (e) => setScale(e.target.value);
                    customInput.oninput = (e) => {
                        const val = parseFloat(e.target.value);
                        if (Number.isFinite(val)) {
                            const clamped = Math.max(0.01, Math.min(64, val));
                            if (wgt) wgt.value = clamped;
                            if (node.updateResLabelTextRef) node.updateResLabelTextRef();
                        }
                    };
                    customInput.addEventListener("mousedown", (e) => e.stopPropagation());
                    customInput.addEventListener("pointerdown", (e) => e.stopPropagation());

                    node._syncHTMLWithWidgets.push(() => {
                        if (wgt && wgt.value !== undefined && wgt.value !== null) {
                            setScale(wgt.value, true);
                        } else {
                            setScale(1, true);
                        }
                    });

                    setScale(wgt && wgt.value !== undefined ? wgt.value : 1, true);
                    row.append(presetRow, customInput);
                    return row;
                };

                const enableResizeRow = createToggleRow("Enable Resize", "enable_resize");
                
                const openCPOBtn = document.createElement("button");
                openCPOBtn.innerText = "Open CPO Editor";
                openCPOBtn.style.cssText = "background: #33789a; color: #fff; border: none; border-radius: 4px; padding: 6px; margin-bottom: 6px; margin-top: 4px; cursor: pointer; font-size: 11px; font-weight: bold; transition: 0.2s; width: 100%; box-shadow: 0 1px 2px rgba(0,0,0,0.3);";
                openCPOBtn.onmouseenter = () => { openCPOBtn.style.background = "#3f8eb4"; };
                openCPOBtn.onmouseleave = () => { openCPOBtn.style.background = "#33789a"; };
                openCPOBtn.onclick = () => {
                    const isWired = node.inputs && node.inputs.some(inp => inp && inp.name === "in_image" && inp.link !== null);
                    if (isWired) {
                        alert("Please disconnect the in_image cable (incoming image) to use the manual canvas editor.");
                        return;
                    }
                    openTrixCropEditor(node, widgets.crop_data);
                };

                const widthRow = createInputRow("Width", "width", "number", [16, 8192, 1024]);
                const heightRow = createInputRow("Height", "height", "number", [16, 8192, 1024]);
                
                const padLeftRow = createInputRow("Pad Left", "pad_left", "number", [0, 16384, 0]);
                const padTopRow = createInputRow("Pad Top", "pad_top", "number", [0, 16384, 0]);
                const padRightRow = createInputRow("Pad Right", "pad_right", "number", [0, 16384, 0]);
                const padBottomRow = createInputRow("Pad Bottom", "pad_bottom", "number", [0, 16384, 0]);

                const upscaleMethodRow = createInputRow("Upscale Method", "upscale_method", "select", ["nearest-exact", "bilinear", "area", "bicubic", "lanczos"]);
                const kpRow = createInputRow("Options", "keep_proportion", "select", ["stretch", "resize", "scale_by", "pad", "pad_edge_pixel", "crop", "pad_for_outpainting"]);
                const scaleByRow = createScaleByRow();
                const conditionRow = createInputRow("Condition", "condition", "select", ["always", "downscale if bigger", "upscale if smaller", "if bigger area", "if smaller area"]);
                const featherRow = createInputRow("Feathering", "feathering", "number", [0, 250, 0]);
                const divisibleByRow = createInputRow("Divisible By", "divisible_by", "number", [1, 256, 2]);

                resizePanel.append(
                    enableResizeRow,
                    openCPOBtn,
                    kpRow,
                    scaleByRow,
                    widthRow, heightRow, 
                    padLeftRow, padTopRow, padRightRow, padBottomRow, 
                    upscaleMethodRow, conditionRow, featherRow, divisibleByRow
                );

                node.updateDynamicVisibilityRef = () => {
                    const kpWgt = getW("keep_proportion");
                    const kpValue = kpWgt ? kpWgt.value : "resize";
                    const isPadOut = kpValue === "pad_for_outpainting";
                    const isScaleBy = kpValue === "scale_by";

                    const padDisplay = isPadOut ? "flex" : "none";
                    const normalDisplay = (!isPadOut && !isScaleBy) ? "flex" : "none";
                    const scaleDisplay = isScaleBy ? "flex" : "none";
                    
                    if (widthRow) widthRow.style.display = normalDisplay;
                    if (heightRow) heightRow.style.display = normalDisplay;
                    if (scaleByRow) scaleByRow.style.display = scaleDisplay;
                    
                    if (padLeftRow) padLeftRow.style.display = padDisplay;
                    if (padTopRow) padTopRow.style.display = padDisplay;
                    if (padRightRow) padRightRow.style.display = padDisplay;
                    if (padBottomRow) padBottomRow.style.display = padDisplay;
                    
                    if (conditionRow) conditionRow.style.display = normalDisplay;
                    if (featherRow) featherRow.style.display = padDisplay;

                    if (upscaleMethodRow) upscaleMethodRow.style.display = "flex";
                    if (kpRow) kpRow.style.display = "flex";
                    if (divisibleByRow) divisibleByRow.style.display = "flex";
                };
                
                node.updateDynamicVisibilityRef();

                // ==========================================
                // CAMERA RAW PANEL BUILD (IN MAIN TAB)
                // ==========================================
                const cameraRawPanel = document.createElement("div");
                cameraRawPanel.className = "trix-resize-panel";
                cameraRawPanel.style.cssText = `display: none; flex-direction: column; width: 100%; height: 100%; padding: 4px 8px; box-sizing: border-box; overflow-y: auto; overflow-x: hidden; pointer-events: auto; background: ${TRIX_PANEL_SOFT}; min-height: 0;`;

                const crEnableRow = createToggleRow("Enable Filter", "cr_enable");
                cameraRawPanel.appendChild(crEnableRow);

                const openCRBtn = document.createElement("button");
                openCRBtn.innerText = "Open Live Camera Raw";
                openCRBtn.style.cssText = "background: #33789a; color: #fff; border: none; border-radius: 4px; padding: 6px; margin-bottom: 6px; margin-top: 4px; cursor: pointer; font-size: 11px; font-weight: bold; transition: 0.2s; width: 100%; box-shadow: 0 1px 2px rgba(0,0,0,0.3);";
                openCRBtn.onmouseenter = () => { openCRBtn.style.background = "#3f8eb4"; };
                openCRBtn.onmouseleave = () => { openCRBtn.style.background = "#33789a"; };
                openCRBtn.onclick = () => {
                    openTrixCameraRawEditor(node);
                };
                cameraRawPanel.appendChild(openCRBtn);

                const hslStatusBtn = document.createElement("button");
                hslStatusBtn.innerText = "Hue/Saturation: Inactive";
                hslStatusBtn.style.cssText = "background: transparent; color: #555; border: 1px solid #333; border-radius: 4px; padding: 4px; font-size: 10px; font-weight: bold; width: 100%; pointer-events: none;";

                const curveStatusBtn = document.createElement("button");
                curveStatusBtn.innerText = "Curves: Inactive";
                curveStatusBtn.style.cssText = "background: transparent; color: #555; border: 1px solid #333; border-radius: 4px; padding: 4px; font-size: 10px; font-weight: bold; width: 100%; pointer-events: none;";

                const statusRow = document.createElement("div");
                statusRow.style.cssText = "display: flex; gap: 6px; width: 100%; margin-bottom: 6px;";
                statusRow.append(hslStatusBtn, curveStatusBtn);
                cameraRawPanel.appendChild(statusRow);

                const rawGroups = [
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

                rawGroups.forEach((group, gIdx) => {
                    if (gIdx > 0) {
                        const sep = document.createElement("hr");
                        sep.style.cssText = "border: none; border-top: 1px solid #333; margin: 4px 0; width: 100%;";
                        cameraRawPanel.appendChild(sep);
                    }
                    group.forEach(conf => {
                        const wgt = getW(conf.id);
                        const row = document.createElement("div");
                        row.style.cssText = "display: flex; flex-direction: row; align-items: center; justify-content: space-between; padding: 2px 4px; margin-bottom: 2px; border-radius: 4px; flex-shrink: 0; min-height: 20px; transition: 0.1s;";
                        row.onmouseenter = () => { row.style.background = "#222"; };
                        row.onmouseleave = () => { row.style.background = "transparent"; };

                        const title = document.createElement("span");
                        title.innerText = conf.label;
                        title.style.cssText = "color: #bbb; font-family: var(--comfy-font-family, sans-serif); font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 0 0 70px; cursor: pointer;";
                        
                        let startVal = (wgt && wgt.value !== undefined && wgt.value !== null) ? parseInt(wgt.value) : 0;
                        if(isNaN(startVal)) startVal = 0;
                        
                        const sliderEl = document.createElement("input");
                        sliderEl.type = "range"; sliderEl.min = conf.min; sliderEl.max = conf.max; sliderEl.value = startVal;
                        sliderEl.style.cssText = "flex: 1; margin: 0 6px; min-width: 30px; cursor: pointer; height: 10px; accent-color: #33789a;"; 
                        
                        const inputEl = document.createElement("input");
                        inputEl.type = "number"; inputEl.min = conf.min; inputEl.max = conf.max; inputEl.value = startVal;
                        inputEl.className = "trix-num";
                        inputEl.style.cssText = "background: #000; color: #fff; border: 1px solid #444; padding: 1px 2px; border-radius: 3px; font-size: 10px; font-family: var(--comfy-font-family, monospace); outline: none; width: 34px; box-sizing: border-box; cursor: pointer; text-align: center; flex-shrink: 0;";
                        
                        sliderEl.addEventListener("mousedown", (e) => e.stopPropagation());
                        sliderEl.addEventListener("pointerdown", (e) => e.stopPropagation());
                        inputEl.addEventListener("mousedown", (e) => e.stopPropagation());
                        inputEl.addEventListener("pointerdown", (e) => e.stopPropagation());

                        const updateVals = (val) => {
                            let parsed = parseInt(val);
                            if(isNaN(parsed)) parsed = 0;
                            parsed = Math.max(conf.min, Math.min(conf.max, parsed));
                            inputEl.value = parsed; sliderEl.value = parsed;
                            if (wgt) wgt.value = parsed;
                            if(app.graph) app.graph.setDirtyCanvas(true, true);
                        };

                        inputEl.onchange = (e) => updateVals(e.target.value);
                        sliderEl.oninput = (e) => updateVals(e.target.value);

                        const doReset = () => updateVals(0);
                        sliderEl.ondblclick = doReset;
                        title.ondblclick = doReset;

                        node._syncHTMLWithWidgets.push(() => {
                            if (wgt && wgt.value !== undefined && wgt.value !== null) {
                                let parsed = parseInt(wgt.value);
                                if (!isNaN(parsed)) { inputEl.value = parsed; sliderEl.value = parsed; }
                            }
                        });
                        row.append(title, sliderEl, inputEl);
                        cameraRawPanel.appendChild(row);
                    });
                });

                const bodyContainer = document.createElement("div");
                bodyContainer.style.cssText = "display: flex; flex: 1; width: 100%; position: relative; overflow: visible; min-height: 0;";

                const viewPort = document.createElement("div");
                viewPort.style.cssText = "position: relative; width: 100%; height: 100%; flex-grow: 1; pointer-events: none; overflow: visible; background: transparent; border-radius: 6px;";
                
                const imgContainer = document.createElement("div");
                imgContainer.style.cssText = "position: absolute; pointer-events: none; margin: 0; transform-origin: 0 0;";

                const applyZoomPan = () => { imgContainer.style.transformOrigin = "0 0"; imgContainer.style.transform = node.isFullscreen ? `translate(${node._fsPanX}px, ${node._fsPanY}px) scale(${node._fsZoom})` : "none"; };
                node.applyZoomPanRef = applyZoomPan;

                const imgTag = document.createElement("img"); imgTag.setAttribute("draggable", "false"); 
                imgTag.style.cssText = "max-width: 100%; max-height: 100%; object-fit: contain; pointer-events: none; user-select: none; -webkit-user-drag: none; display: block;";
                imgTag.crossOrigin = "Anonymous"; node.imgTagRef = imgTag; 
                
                const maskCanvas = document.createElement("canvas");
                maskCanvas.style.cssText = "position: absolute; top: 0; left: 0; cursor: none; z-index: 2; pointer-events: none;";
                const mctx = maskCanvas.getContext("2d", { willReadFrequently: true }); node.maskCanvasRef = maskCanvas; maskCanvas.oncontextmenu = (e) => e.preventDefault();

                const brushCursor = document.createElement("div");
                brushCursor.style.cssText = "position: absolute; border: 1.5px solid rgba(255, 255, 255, 0.9); border-radius: 50%; pointer-events: none; display: none; z-index: 100; transform: translate(-50%, -50%); box-sizing: border-box; box-shadow: 0 0 2px rgba(0,0,0,0.8) inset, 0 0 2px rgba(0,0,0,0.8);";
                brushCursor.innerHTML = `<div style="position: absolute; top: 50%; left: 50%; width: 3px; height: 3px; background: rgba(255, 255, 255, 0.9); border-radius: 50%; transform: translate(-50%, -50%); box-sizing: border-box; box-shadow: 0 0 1px rgba(0,0,0,0.8);"></div>`;
                
                imgContainer.append(imgTag, maskCanvas, brushCursor);

                const resLabel = document.createElement("div");
                resLabel.style.cssText = "position: absolute; left: 0; top: 0; width: 100%; height: 100%; font-size: 10px; color: #ccc; font-family: monospace; user-select: none; pointer-events: none; box-sizing: border-box; display: none; align-items: center; justify-content: center; z-index: 5; padding-bottom: 2px;";
                resLabel.innerText = "0 x 0"; node.resLabelRef = resLabel;
                toolBar.appendChild(resLabel);

                viewPort.append(imgContainer); bodyContainer.append(viewPort, cameraRawPanel, resizePanel); wrapper.append(headerContainer, bodyContainer);
                
                const trixWidget = node.addDOMWidget("trix_ui_v2", "div", wrapper, { hideOnZoom: false });
                node.trixWidgetRef = trixWidget;
                if (trixWidget && trixWidget.element) {
                    trixWidget.element.style.pointerEvents = "auto";
                    trixWidget.element.style.background = "transparent";
                    trixWidget.element.style.overflow = "visible";
                    trixWidget.element.style.border = "none";
                    trixWidget.element.style.outline = "none";
                    trixWidget.element.style.boxShadow = "none";
                    
                    const origDraw = trixWidget.draw;
                    trixWidget.draw = function(ctx, n, widget_width, y, H) {
                        const oldStroke = ctx.strokeStyle;
                        const oldFill = ctx.fillStyle;
                        const oldAlpha = ctx.globalAlpha;
                        ctx.strokeStyle = "transparent";
                        ctx.fillStyle = "transparent";
                        ctx.globalAlpha = 0;
                        if (origDraw) origDraw.apply(this, arguments);
                        ctx.strokeStyle = oldStroke;
                        ctx.fillStyle = oldFill;
                        ctx.globalAlpha = oldAlpha;
                        if (this.element && !n.isFullscreen) {
                            this.element.style.setProperty("width", (n.size[0] - 2) + "px", "important");
                            /* To shift the toolbar/buttons left or right, adjust this -6px value */
                            this.element.style.setProperty("left", "-9px", "important");
                            this.element.style.setProperty("margin", "0px", "important");
                            this.element.style.setProperty("padding", "0px 2px", "important");
                            this.element.style.setProperty("box-sizing", "border-box", "important");
                            this.element.style.setProperty("background", "transparent", "important");
                            this.element.style.setProperty("overflow", "visible", "important");
                            this.element.style.setProperty("border", "none", "important");
                            this.element.style.setProperty("outline", "none", "important");
                            this.element.style.setProperty("box-shadow", "none", "important");
                        }
                    };
                }

                let currentScale = 1;

                const updateCursorSize = () => { 
                    const visualSize = node.brushSize * currentScale; 
                    brushCursor.style.width = `${visualSize}px`; 
                    brushCursor.style.height = `${visualSize}px`; 
                    
                    const hardStop = Math.max(0, node.brushHardness * 100);
                    brushCursor.style.background = `radial-gradient(circle, rgba(255,255,255,0.3) ${hardStop}%, rgba(255,255,255,0) 100%)`;
                    brushCursor.style.borderColor = `rgba(255, 255, 255, ${0.3 + (node.brushHardness * 0.7)})`;
                };

                maskCanvas.addEventListener("pointerenter", () => { const mode = widgets.mode ? widgets.mode.value : "Base"; if (mode === "Mask" && (!node.isPreviewHidden || node.isFullscreen)) brushCursor.style.display = "block"; });
                maskCanvas.addEventListener("pointerleave", () => { brushCursor.style.display = "none"; });

                node.onResize = function(size) {
                    if (size[0] < 200) size[0] = 200;
                    if (size[1] < 200) size[1] = 200;
                    if (node.alignCanvasRef) node.alignCanvasRef();
                };

                const alignCanvas = () => {
                    if (!imgTag.naturalWidth) return;

                    if (node.isFullscreen) {
                        const aspect = imgTag.naturalHeight / imgTag.naturalWidth;
                        let availableW = window.innerWidth * 0.9 - 40; 
                        let maxH = window.innerHeight * 0.9 - 100; 
                        let scaledH = availableW * aspect;
                        
                        if (scaledH > maxH) { scaledH = maxH; availableW = scaledH / aspect; }
                        currentScale = availableW / imgTag.naturalWidth;
                        
                        node.headerContainerRef.style.width = "100%"; 
                        node.headerContainerRef.style.maxWidth = `${availableW}px`; 
                        node.headerContainerRef.style.alignSelf = "center";
                        
                        const vpRect = viewPort.getBoundingClientRect();
                        if (vpRect.width > 0) {
                            imgContainer.style.left = `${(vpRect.width - availableW) / 2}px`;
                            imgContainer.style.top = `${(vpRect.height - scaledH) / 2}px`;
                        } else {
                            imgContainer.style.left = "0px"; imgContainer.style.top = "0px";
                        }
                        
                        imgContainer.style.width = availableW + "px"; imgContainer.style.height = scaledH + "px";
                        imgTag.style.width = availableW + "px"; imgTag.style.height = scaledH + "px";
                        maskCanvas.style.width = availableW + "px"; maskCanvas.style.height = scaledH + "px";
                    } else {
                        const metrics = node.getLayoutMetrics();
                        if (!metrics) return;

                        currentScale = metrics.scale;
                        
                        node.headerContainerRef.style.width = "100%"; 
                        node.headerContainerRef.style.maxWidth = "none"; 
                        node.headerContainerRef.style.alignSelf = "stretch";

                        if (node.trixWidgetRef && node.trixWidgetRef.element) {
                            node.trixWidgetRef.element.style.setProperty("width", (node.size[0] - 2) + "px", "important");
                            /* To shift the toolbar/buttons left or right, adjust this -6px value */
                            node.trixWidgetRef.element.style.setProperty("left", "-9px", "important");
                            node.trixWidgetRef.element.style.setProperty("margin", "0px", "important");
                            node.trixWidgetRef.element.style.setProperty("padding", "0px 2px", "important");
                            node.trixWidgetRef.element.style.setProperty("box-sizing", "border-box", "important");
                            node.trixWidgetRef.element.style.setProperty("overflow", "visible", "important");
                            node.trixWidgetRef.element.style.setProperty("border", "none", "important");
                            node.trixWidgetRef.element.style.setProperty("outline", "none", "important");
                            node.trixWidgetRef.element.style.setProperty("box-shadow", "none", "important");
                            wrapper.style.width = "100%";
                            wrapper.style.marginLeft = "0px";
                        }

                        imgContainer.style.left = `${metrics.localX}px`; 
                        imgContainer.style.top = `${metrics.localY}px`;
                        imgContainer.style.width = `${metrics.w}px`; 
                        imgContainer.style.height = `${metrics.h}px`;
                        
                        imgTag.style.width = `${metrics.w}px`; 
                        imgTag.style.height = `${metrics.h}px`;
                        maskCanvas.style.width = `${metrics.w}px`; 
                        maskCanvas.style.height = `${metrics.h}px`;
                    }
                    updateCursorSize();

                    if (node.resLabelRef && imgTag.naturalWidth > 0) {
                        if (node.updateResLabelTextRef) node.updateResLabelTextRef();
                    }
                };
                node.alignCanvasRef = alignCanvas;

                node._onResizeWindow = () => { if (node.isFullscreen) { node._fsZoom = 1.0; node._fsPanX = 0; node._fsPanY = 0; applyZoomPan(); alignCanvas(); } };
                node._onKeydownWindow = (e) => { if (e.key === "Escape" && node.isFullscreen) { node.isFullscreen = false; updateUI(); } };
                window.addEventListener("resize", node._onResizeWindow); window.addEventListener("keydown", node._onKeydownWindow);

                const saveHistory = () => { 
                    const data = maskCanvas.toDataURL(); 
                    if (node.historyIndex < node.history.length - 1) node.history = node.history.slice(0, node.historyIndex + 1); 
                    node.history.push(data); 
                    if (node.history.length > 15) node.history.shift(); 
                    node.historyIndex = node.history.length - 1; 
                    
                    if (widgets.mask_data) {
                        widgets.mask_data.value = data; 
                    }
                };
                node.saveHistoryRef = saveHistory;

                imgTag.onload = () => { 
                    const preservedMaskData = (widgets.mask_data && widgets.mask_data.value) ||
                        (maskCanvas.width > 0 && maskCanvas.height > 0 ? maskCanvas.toDataURL() : "");
                    maskCanvas.width = imgTag.naturalWidth; 
                    maskCanvas.height = imgTag.naturalHeight;

                    if (node._isFirstLoad) {
                        node._isFirstLoad = false;
                        const targetW = 300; 
                        const headerReserve = node.headerContainerRef ? Math.max(72, node.headerContainerRef.offsetHeight + 18) : 112;
                        const targetH = Math.round((imgTag.naturalHeight / imgTag.naturalWidth) * targetW) + headerReserve; 
                        node.size = [targetW, targetH];
                        if (app.graph) app.graph.setDirtyCanvas(true, true);
                    }
                    
                    alignCanvas(); 
                    
                    if (preservedMaskData && widgets.mask_data) {
                        widgets.mask_data.value = preservedMaskData;
                    }
                    const restoreMaskPromise = node.syncMaskToCanvas ? node.syncMaskToCanvas() : Promise.resolve(false);

                    if (node._isConfiguring) return; 

                    if (node._isChangingImage) {
                        restoreMaskPromise.then(() => {
                            node.history = [];
                            node.historyIndex = -1;
                            node._lastClickPos = null; 
                            saveHistory(); 
                            node._isChangingImage = false;
                            if (app.graph) app.graph.setDirtyCanvas(true, true);
                        });
                        return;
                    } 
                    if (app.graph) app.graph.setDirtyCanvas(true, true);
                };

                const applyHistory = (idx) => { 
                    if (idx < 0) {
                        idx = 0; 
                    }
                    if (idx >= node.history.length) {
                        idx = node.history.length - 1;
                    }

                    let restoreData = null;
                    if (node.history.length > 0 && node.history[idx]) {
                        node.historyIndex = idx;
                        restoreData = node.history[idx];
                    } else if (widgets.mask_data && widgets.mask_data.value) {
                        restoreData = widgets.mask_data.value;
                    }

                    if (restoreData) {
                        if (widgets.mask_data) widgets.mask_data.value = restoreData;
                        node.syncMaskToCanvas();
                        node._lastClickPos = null;
                    }
                };
                
                undoBtn.onclick = () => applyHistory(node.historyIndex - 1);
                redoBtn.onclick = () => applyHistory(node.historyIndex + 1); 
                
                clearBtn.onclick = () => { 
                    mctx.globalCompositeOperation = "source-over"; 
                    mctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height); 
                    if (node.isEraser) mctx.globalCompositeOperation = "destination-out"; 
                    node._lastClickPos = null; 
                    saveHistory(); 
                    if (app.graph) app.graph.setDirtyCanvas(true, true); 
                };

                let drawing = false; 
                let isPanning = false; 
                let resizingBrush = false; 
                let resizeStartX = 0; 
                let resizeStartY = 0; 
                let initialBrushSize = 0;
                let initialBrushHardness = 1.0;

                const getCanvasCoord = (e) => {
                    const rect = maskCanvas.getBoundingClientRect();
                    const xNorm = (e.clientX - rect.left) / rect.width;
                    const yNorm = (e.clientY - rect.top) / rect.height;
                    const x = xNorm * maskCanvas.width;
                    const y = yNorm * maskCanvas.height;
                    const cssX = xNorm * maskCanvas.offsetWidth;
                    const cssY = yNorm * maskCanvas.offsetHeight;
                    return { x, y, cssX, cssY };
                };

                maskCanvas.onpointerdown = (e) => {
                    if (app.canvas) app.canvas.allow_dragcanvas = false;
                    try { maskCanvas.setPointerCapture(e.pointerId); } catch(err){}
                    
                    const mode = widgets.mode ? widgets.mode.value : "Base"; if (mode !== "Mask") return;

                    if (node.history.length === 0 && node.saveHistoryRef) {
                        node.saveHistoryRef();
                    }

                    if (e.button === 0 && e.ctrlKey) { 
                        drawing = false; 
                        const { x, y } = getCanvasCoord(e); 
                        let fR = 0, fG = 0, fB = 0, fA = 0; 
                        if (!node.isEraser) { 
                            const hex = node.maskColor.replace(/^#/, ""); 
                            const bigint = parseInt(hex, 16); 
                            fR = (bigint >> 16) & 255; fG = (bigint >> 8) & 255; fB = bigint & 255; fA = 255; 
                        } 
                        doFloodFillWorker(mctx, x, y, fR, fG, fB, fA, 200).then(() => { 
                            node._lastClickPos = null; 
                            saveHistory(); 
                            if (app.graph) app.graph.setDirtyCanvas(true, true); 
                        }); 
                        e.preventDefault(); e.stopPropagation(); return; 
                    }
                    if (e.button === 1 && node.isFullscreen) { isPanning = true; e.preventDefault(); e.stopPropagation(); return; }
                    
                    if (e.button === 2 && e.altKey) { 
                        resizingBrush = true; resizeStartX = e.clientX; resizeStartY = e.clientY; node._accumulatedMovementX = 0; node._accumulatedMovementY = 0; initialBrushSize = parseFloat(node.brushSize); initialBrushHardness = parseFloat(node.brushHardness); node._resizeAxisLock = null; 
                        const { cssX, cssY } = getCanvasCoord(e); node._lockedCssX = cssX; node._lockedCssY = cssY; 
                        if (maskCanvas.requestPointerLock) maskCanvas.requestPointerLock(); 
                        e.preventDefault(); e.stopPropagation(); return; 
                    }
                    if (e.button !== 0 && e.button !== 2) return; 

                    drawing = true;
                    node._isRmbErasing = (e.button === 2);
                    node._wasShiftDrawing = e.shiftKey;
                    const { x, y, cssX, cssY } = getCanvasCoord(e);
                    brushCursor.style.left = `${cssX}px`; brushCursor.style.top = `${cssY}px`; brushCursor.style.display = "block";

                    const blurAmount = (1 - node.brushHardness) * (node.brushSize / 4);
                    const drawSize = Math.max(1, node.brushSize - blurAmount);

                    mctx.lineWidth = drawSize; 
                    mctx.lineCap = "round"; 
                    mctx.lineJoin = "round"; 
                    mctx.globalCompositeOperation = (node.isEraser || node._isRmbErasing) ? "destination-out" : "source-over"; 
                    
                    if (blurAmount > 0) {
                        mctx.shadowBlur = blurAmount;
                        mctx.shadowColor = node.maskColor;
                        mctx.shadowOffsetX = 100000;
                        mctx.shadowOffsetY = 100000;
                        mctx.strokeStyle = "rgba(0,0,0,1)"; 
                        mctx.fillStyle = "rgba(0,0,0,1)";

                        if (e.shiftKey && node._lastClickPos) { 
                            mctx.beginPath(); mctx.moveTo(node._lastClickPos.x - 100000, node._lastClickPos.y - 100000); mctx.lineTo(x - 100000, y - 100000); mctx.stroke(); 
                        } else { 
                            mctx.beginPath(); mctx.arc(x - 100000, y - 100000, drawSize / 2, 0, Math.PI * 2); mctx.fill(); 
                        }
                    } else {
                        mctx.shadowBlur = 0;
                        mctx.shadowColor = "transparent";
                        mctx.shadowOffsetX = 0;
                        mctx.shadowOffsetY = 0;
                        mctx.strokeStyle = node.maskColor; 
                        mctx.fillStyle = node.maskColor;

                        if (e.shiftKey && node._lastClickPos) { 
                            mctx.beginPath(); mctx.moveTo(node._lastClickPos.x, node._lastClickPos.y); mctx.lineTo(x, y); mctx.stroke(); 
                        } else { 
                            mctx.beginPath(); mctx.arc(x, y, drawSize / 2, 0, Math.PI * 2); mctx.fill(); 
                        }
                    }
                    mctx.shadowBlur = 0;
                    mctx.shadowOffsetX = 0;
                    mctx.shadowOffsetY = 0;
                    
                    node._lp = [x, y]; node._lastClickPos = { x, y }; node._dragStartX = x; node._dragStartY = y; node._shiftLockAxis = null; e.preventDefault(); e.stopPropagation(); if (app.graph) app.graph.setDirtyCanvas(true, true); 
                };

                maskCanvas.onpointermove = (e) => {
                    const mode = widgets.mode ? widgets.mode.value : "Base"; if (mode !== "Mask") return;
                    if (isPanning) { node._fsPanX += e.movementX; node._fsPanY += e.movementY; applyZoomPan(); e.preventDefault(); e.stopPropagation(); return; }
                    
                    if (resizingBrush) { 
                        let deltaX = 0; let deltaY = 0;
                        if (document.pointerLockElement === maskCanvas) { 
                            node._accumulatedMovementX += (e.movementX || 0); node._accumulatedMovementY += (e.movementY || 0); 
                            deltaX = node._accumulatedMovementX; deltaY = node._accumulatedMovementY;
                        } else { deltaX = e.clientX - resizeStartX; deltaY = e.clientY - resizeStartY; } 
                        if (!node._resizeAxisLock) { if (Math.abs(deltaX) > 5) node._resizeAxisLock = 'x'; else if (Math.abs(deltaY) > 5) node._resizeAxisLock = 'y'; }
                        
                        if (node._resizeAxisLock === 'x') { 
                            let newSize = initialBrushSize + (deltaX * 0.5); 
                            newSize = Math.max(1, Math.min(250, newSize)); 
                            node.brushSize = newSize; slider.value = newSize; 
                            if(node._sizeNum) node._sizeNum.value = Math.round(newSize);
                        } else if (node._resizeAxisLock === 'y') { 
                            let newHardness = initialBrushHardness + (deltaY * 0.005); 
                            newHardness = Math.max(0, Math.min(1, newHardness)); 
                            node.brushHardness = newHardness; hardnessSlider.value = newHardness * 100; 
                            if(node._hardnessNum) node._hardnessNum.value = Math.round(newHardness * 100);
                        }
                        
                        brushCursor.style.left = `${node._lockedCssX}px`; brushCursor.style.top = `${node._lockedCssY}px`; brushCursor.style.display = "block"; updateCursorSize(); e.preventDefault(); e.stopPropagation(); return; 
                    }
                    
                    const { x, y, cssX, cssY } = getCanvasCoord(e); let cursorX = cssX; let cursorY = cssY; let currentX = x; let currentY = y;
                    
                    if (!drawing) { brushCursor.style.left = `${cssX}px`; brushCursor.style.top = `${cssY}px`; brushCursor.style.display = "block"; return; }
                    if (node._wasShiftDrawing && !e.shiftKey) { drawing = false; node._shiftLockAxis = null; node._wasShiftDrawing = false; saveHistory(); if (app.graph) app.graph.setDirtyCanvas(true, true); return; }
                    if (e.shiftKey) { node._wasShiftDrawing = true; if (!node._shiftLockAxis) { if (Math.abs(currentX - node._dragStartX) > Math.abs(currentY - node._dragStartY)) node._shiftLockAxis = 'y'; else if (Math.abs(currentY - node._dragStartY) > Math.abs(currentX - node._dragStartX)) node._shiftLockAxis = 'x'; } if (node._shiftLockAxis === 'y') { currentY = node._dragStartY; cursorY = currentY * currentScale; } else if (node._shiftLockAxis === 'x') { currentX = node._dragStartX; cursorX = currentX * currentScale; } } else { node._shiftLockAxis = null; node._dragStartX = currentX; node._dragStartY = currentY; }
                    brushCursor.style.left = `${cursorX}px`; brushCursor.style.top = `${cursorY}px`; brushCursor.style.display = "block";
                    
                    const blurAmount = (1 - node.brushHardness) * (node.brushSize / 4);
                    const drawSize = Math.max(1, node.brushSize - blurAmount);

                    mctx.lineWidth = drawSize; 
                    mctx.lineCap = "round"; 
                    mctx.lineJoin = "round"; 
                    mctx.globalCompositeOperation = (node.isEraser || node._isRmbErasing) ? "destination-out" : "source-over"; 
                    
                    if (blurAmount > 0) {
                        mctx.shadowBlur = blurAmount;
                        mctx.shadowColor = node.maskColor;
                        mctx.shadowOffsetX = 100000;
                        mctx.shadowOffsetY = 100000;
                        mctx.strokeStyle = "rgba(0,0,0,1)"; 
                        mctx.fillStyle = "rgba(0,0,0,1)";
                        
                        mctx.beginPath(); 
                        mctx.moveTo(node._lp[0] - 100000, node._lp[1] - 100000); 
                        mctx.lineTo(currentX - 100000, currentY - 100000); 
                        mctx.stroke();
                    } else {
                        mctx.shadowBlur = 0;
                        mctx.shadowColor = "transparent";
                        mctx.shadowOffsetX = 0;
                        mctx.shadowOffsetY = 0;
                        mctx.strokeStyle = node.maskColor; 
                        mctx.fillStyle = node.maskColor;
                        
                        mctx.beginPath(); 
                        mctx.moveTo(node._lp[0], node._lp[1]); 
                        mctx.lineTo(currentX, currentY); 
                        mctx.stroke();
                    }
                    mctx.shadowBlur = 0;
                    mctx.shadowOffsetX = 0;
                    mctx.shadowOffsetY = 0;

                    node._lp = [currentX, currentY]; node._lastClickPos = { x: currentX, y: currentY }; e.preventDefault(); e.stopPropagation(); if (node.requestDirtyCanvas) node.requestDirtyCanvas();
                };

                node._pointerUpHandler = (e) => { 
                    if (app.canvas) app.canvas.allow_dragcanvas = true;
                    if (isPanning) { isPanning = false; e.preventDefault(); } 
                    if (resizingBrush) { resizingBrush = false; if (document.pointerLockElement === maskCanvas) document.exitPointerLock(); e.preventDefault(); } 
                    if (drawing) { drawing = false; node._isRmbErasing = false; try { maskCanvas.releasePointerCapture(e.pointerId); } catch(err){} saveHistory(); } 
                };
                window.addEventListener("pointerup", node._pointerUpHandler, { capture: true });

                const updateUI = (forceReload = false) => {
                    const mode = widgets.mode ? widgets.mode.value : "Base"; node._lastMode = mode;
                    const isInImageConnected = node.inputs && node.inputs.some(inp => inp.name === "in_image" && inp.link !== null);
                    const isResizeMode = mode === "Resize";
                    removeNativeUploadWidget();

                    toolBar.style.minHeight = `${isResizeMode ? TOOLBAR_HEIGHT_RESIZE : TOOLBAR_HEIGHT_BASE_MASK}px`;
                    toolBar.style.padding = "1px 6px 2px 6px";
                    toolBar.style.background = (mode === "Base" || mode === "Resize") ? TOOLBAR_BG_LIGHT : TOOLBAR_BG_DARK;

                    if (filePanel) {
                        filePanel.style.display = isInImageConnected ? "none" : "flex";
                        if (!isInImageConnected && node.refreshImagePickerRef) node.refreshImagePickerRef();
                    }

                    if (widgets.image) { 
                        hideWidget(widgets.image);
                    }

                    Object.keys(btnRef).forEach(k => { 
                        let isSelected = (k === mode);
                        let bgColor = "transparent";
                        let color = "#aaa";

                        const isEnableResize = (widgets.enable_resize && widgets.enable_resize.value);
                        const isCrEnabled = (widgets.cr_enable && widgets.cr_enable.value);

                        if (k === "Resize") {
                            if (isEnableResize) {
                                bgColor = "rgb(246, 103, 68)";
                                color = "#fff";
                            } else {
                                bgColor = isSelected ? "#33789a" : "rgba(255, 255, 255, 0.2)";
                                color = "#fff";
                            }
                        } else if (k === "Base") {
                            if (isCrEnabled) {
                                bgColor = "rgb(246, 103, 68)";
                                color = "#fff";
                            } else {
                                bgColor = isSelected ? "#33789a" : "rgba(255, 255, 255, 0.2)";
                                color = "#fff";
                            }
                        } else {
                            bgColor = isSelected ? "#33789a" : "rgba(255, 255, 255, 0.2)";
                            color = "#fff";
                        }

                        btnRef[k].style.background = bgColor; 
                        btnRef[k].style.color = color;
                    });

                    if (widgets.mode) { hideWidget(widgets.mode); }

                    const showTools = mode === "Mask" && !node._isToolbarHidden;

                    toolBar.style.display = "grid";
                    toolBar.style.visibility = "visible"; 
                    toolBar.style.opacity = "1";

                    Array.from(toolBar.children).forEach(child => {
                        if (child === node.resLabelRef) return;
                        child.style.visibility = showTools ? "visible" : "hidden";
                        child.style.opacity = showTools ? "1" : "0";
                        child.style.pointerEvents = showTools ? "auto" : "none";
                    });

                    if (mode === "Mask") {
                        if (node.resLabelRef) node.resLabelRef.style.display = "none";
                    } else {
                        if (node.resLabelRef && !node.isPreviewHidden && !node._showCameraRawMenu && !node.isFullscreen) {
                            node.resLabelRef.style.display = "flex";
                            if (mode === "Base") {
                                node.resLabelRef.style.justifyContent = "center";
                            } else {
                                node.resLabelRef.style.justifyContent = "flex-start";
                            }
                            if (node.updateResLabelTextRef) node.updateResLabelTextRef();
                        } else if (node.resLabelRef) {
                            node.resLabelRef.style.display = "none";
                        }
                    }

                    if (mode === "Resize") {
                        viewPort.style.display = "none"; cameraRawPanel.style.display = "none"; resizePanel.style.display = "flex";
                        bodyContainer.style.overflow = "hidden";
                        
                        if (wrapper.parentNode === document.body && node._domPlaceholder && node._domPlaceholder.parentNode) { node._domPlaceholder.parentNode.replaceChild(wrapper, node._domPlaceholder); }
                        
                        node.headerContainerRef.style.marginTop = `${TRIX_HEADER_OFFSET_Y}px`;
                        wrapper.style.position = "relative"; wrapper.style.top = "auto"; wrapper.style.left = "auto"; wrapper.style.transform = "none"; wrapper.style.width = "100%"; wrapper.style.height = "100%"; wrapper.style.zIndex = ""; wrapper.style.background = "transparent"; wrapper.style.padding = "4px 0px 2px 0px"; wrapper.style.borderRadius = "0"; applyNodeDomSideOutline(); 
                        resizePanel.style.width = "100%"; resizePanel.style.borderRight = "none";

                    } else if (mode === "Base") {
                        resizePanel.style.display = "none";
                        
                        if (node._showCameraRawMenu) {
                            viewPort.style.display = "none";
                            cameraRawPanel.style.display = "flex";
                            bodyContainer.style.overflow = "hidden";
                        } else {
                            viewPort.style.display = "flex";
                            cameraRawPanel.style.display = "none";
                            bodyContainer.style.overflow = "visible";
                        }
                        
                        imgTag.style.opacity = "0";
                        maskCanvas.style.opacity = "0";
                        
                        if (wrapper.parentNode === document.body && node._domPlaceholder && node._domPlaceholder.parentNode) { node._domPlaceholder.parentNode.replaceChild(wrapper, node._domPlaceholder); }

                        node.headerContainerRef.style.marginTop = `${TRIX_HEADER_OFFSET_Y}px`;
                        wrapper.style.position = "relative"; wrapper.style.top = "auto"; wrapper.style.left = "auto"; wrapper.style.transform = "none"; wrapper.style.width = "100%"; wrapper.style.height = "100%"; wrapper.style.zIndex = ""; wrapper.style.background = "transparent"; wrapper.style.padding = "4px 0px 2px 0px"; wrapper.style.borderRadius = "0"; applyNodeDomSideOutline(); 
                        
                        viewPort.style.justifyContent = "center"; viewPort.style.overflow = "visible"; 
                        if (node.resLabelRef) node.resLabelRef.style.display = (node.isPreviewHidden || node._showCameraRawMenu) ? "none" : "block";
                        
                        hardnessRow.wrap.style.display = "none"; 
                        if(node._sizeNum) node._sizeNum.style.display = "none";
                        if(node._hardnessNum) node._hardnessNum.style.display = "none";

                    } else {
                        resizePanel.style.display = "none"; cameraRawPanel.style.display = "none";
                        bodyContainer.style.overflow = "visible";

                        if (node.isFullscreen) {
                            if (!node._domPlaceholder) { node._domPlaceholder = document.createElement("div"); node._domPlaceholder.style.width = "100%"; node._domPlaceholder.style.height = "100%"; }
                            if (wrapper.parentNode && wrapper.parentNode !== document.body) { wrapper.parentNode.replaceChild(node._domPlaceholder, wrapper); document.body.appendChild(wrapper); }

                            node.headerContainerRef.style.marginTop = "0px";
                            wrapper.style.position = "fixed"; wrapper.style.top = "50%"; wrapper.style.left = "50%"; wrapper.style.transform = "translate(-50%, -50%)"; wrapper.style.width = "90vw"; wrapper.style.height = "90vh"; wrapper.style.zIndex = "9999"; wrapper.style.background = "rgba(18, 18, 20, 0.98)"; wrapper.style.padding = "20px"; wrapper.style.borderRadius = "12px"; wrapper.style.boxShadow = "0 10px 50px rgba(0,0,0,0.8)"; 
                            viewPort.style.justifyContent = "center"; viewPort.style.overflow = "hidden"; 
                            
                            imgTag.style.opacity = node.isPreviewHidden ? "0" : "1"; 
                            maskCanvas.style.opacity = node._isMaskHidden ? "0" : "0.8"; 
                            viewPort.style.display = "flex"; node.resLabelRef.style.display = "none";
                            
                            hardnessRow.wrap.style.display = "flex"; 
                            if(node._sizeNum) node._sizeNum.style.display = "block";
                            if(node._hardnessNum) node._hardnessNum.style.display = "block";
                        } else {
                            if (wrapper.parentNode === document.body && node._domPlaceholder && node._domPlaceholder.parentNode) { node._domPlaceholder.parentNode.replaceChild(wrapper, node._domPlaceholder); }

                            node.headerContainerRef.style.marginTop = `${TRIX_HEADER_OFFSET_Y}px`;
                            wrapper.style.position = "relative"; wrapper.style.top = "auto"; wrapper.style.left = "auto"; wrapper.style.transform = "none"; wrapper.style.width = "100%"; wrapper.style.height = "100%"; wrapper.style.zIndex = ""; wrapper.style.background = "transparent"; wrapper.style.padding = "4px 0px 2px 0px"; wrapper.style.borderRadius = "0"; applyNodeDomSideOutline(); 
                            viewPort.style.justifyContent = "center"; viewPort.style.overflow = "visible"; 
                            
                            imgTag.style.opacity = "0"; 
                            maskCanvas.style.opacity = "0"; 
                            
                            viewPort.style.display = "flex"; 
                            if (node.resLabelRef) node.resLabelRef.style.display = node.isPreviewHidden ? "none" : "block";
                            
                            hardnessRow.wrap.style.display = "none"; 
                            if(node._sizeNum) node._sizeNum.style.display = "none";
                            if(node._hardnessNum) node._hardnessNum.style.display = "none";
                        }
                    }

                    if (widgets.mask_data) { hideWidget(widgets.mask_data); }
                    if (widgets.crop_data) { hideWidget(widgets.crop_data); }
                    if (widgets.cr_enable) { hideWidget(widgets.cr_enable); }
                    if (widgets.hsl_active) { hideWidget(widgets.hsl_active); }
                    if (widgets.hsl_data) { hideWidget(widgets.hsl_data); }
                    if (findW("curve_active")) { hideWidget(findW("curve_active")); }
                    if (findW("curve_data")) { hideWidget(findW("curve_data")); }
                    
                    if (widgets.resize && Array.isArray(widgets.resize)) {
                        widgets.resize.forEach(w => { 
                            if (w && !w.name.startsWith("cr_") && !w.name.startsWith("hsl_") && !w.name.startsWith("curve_")) { hideWidget(w); } 
                        });
                    }
                    
                    if (node.widgets) {
                        node.widgets.forEach(w => {
                            if (w && w.name && (w.name.startsWith("cr_") || w.name.startsWith("hsl_") || w.name.startsWith("curve_"))) {
                                hideWidget(w);
                            }
                        });
                    }

                    alignCanvas();

                    maskCanvas.style.pointerEvents = (mode === "Mask" && (!node.isPreviewHidden || node.isFullscreen)) ? "auto" : "none";

                    const name = widgets.image ? widgets.image.value : null;
                    if (name) {
                        let filename = name; let subfolder = ""; if (name.includes("/")) { const parts = name.split("/"); filename = parts.pop(); subfolder = parts.join("/"); }
                        const url = `/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=${encodeURIComponent(subfolder)}&t=${Date.now()}`;
                        
                        if (node._isConfiguring) {
                            node._lastImageName = name;
                            imgTag.src = url;
                        } else if (forceReload || node._lastImageName !== name || !imgTag.src) { 
                            node._lastImageName = name; 
                            imgTag.src = url;
                        }
                    }

                    const wHslActive = getW("hsl_active");
                    const isHslOn = wHslActive ? wHslActive.value : false;
                    const wCurveActive = getW("curve_active");
                    const isCurveOn = wCurveActive ? wCurveActive.value : false;
                    if (hslStatusBtn) {
                        hslStatusBtn.innerText = isHslOn ? "Hue/Saturation: Active" : "Hue/Saturation: Inactive";
                        hslStatusBtn.style.background = isHslOn ? "rgb(246, 103, 68)" : "transparent";
                        hslStatusBtn.style.color = isHslOn ? "#fff" : "#555";
                        hslStatusBtn.style.borderColor = isHslOn ? "rgb(246, 103, 68)" : "#333";
                    }
                    if (curveStatusBtn) {
                        curveStatusBtn.innerText = isCurveOn ? "Curves: Active" : "Curves: Inactive";
                        curveStatusBtn.style.background = isCurveOn ? "rgb(246, 103, 68)" : "transparent";
                        curveStatusBtn.style.color = isCurveOn ? "#fff" : "#555";
                        curveStatusBtn.style.borderColor = isCurveOn ? "rgb(246, 103, 68)" : "#333";
                    }
                    
                    if (node.updateDynamicVisibilityRef) node.updateDynamicVisibilityRef();
                    if (app.graph) app.graph.setDirtyCanvas(true, true);
                };
                node.updateUIRef = updateUI; 

                const imgWidget = widgets.image; 
                if (imgWidget) {
                    const oldCb = imgWidget.callback;
                    imgWidget.callback = function() {
                        if (oldCb) oldCb.apply(this, arguments); 
                        const currentVal = imgWidget.value; 
                        if (!currentVal) return;
                        
                        if (!currentVal.includes("aio_crop_") && !currentVal.includes("clipspace-painted-masked")) {
                            node._originalImageForCrop = currentVal;
                        }
                        
                        if (node._isConfiguring) {
                            node._baseImageName = currentVal;
                            return; 
                        }

                        if (currentVal.includes("clipspace-painted-masked")) {
                            if (node._baseImageName && !node._baseImageName.includes("clipspace-painted-masked")) { imgWidget.value = node._baseImageName; }
                            let filename = currentVal; let subfolder = ""; if (currentVal.includes("/")) { const parts = currentVal.split("/"); filename = parts.pop(); subfolder = parts.join("/"); }
                            const maskUrl = `/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=${encodeURIComponent(subfolder)}&t=${Date.now()}`;

                            fetch(maskUrl).then(r => r.blob()).then(blob => {
                                const blobUrl = URL.createObjectURL(blob); const tempImg = new Image();
                                tempImg.onload = () => {
                                    if (maskCanvas.width !== tempImg.naturalWidth) { maskCanvas.width = tempImg.naturalWidth; maskCanvas.height = tempImg.naturalHeight; alignCanvas(); }
                                    const mctx = maskCanvas.getContext("2d", { willReadFrequently: true });
                                    mctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height); const tcanvas = document.createElement('canvas'); tcanvas.width = tempImg.naturalWidth; tcanvas.height = tempImg.naturalHeight; const tctx = tcanvas.getContext('2d', { willReadFrequently: true }); tctx.drawImage(tempImg, 0, 0); const imgData = tctx.getImageData(0, 0, tcanvas.width, tcanvas.height); const pixels = imgData.data;
                                    let r = 255, g = 0, b = 0; if (node.maskColor) { const hex = node.maskColor.replace(/^#/, ""); const bigint = parseInt(hex, 16); r = (bigint >> 16) & 255; g = (bigint >> 8) & 255; b = bigint & 255; }
                                    let hasAlpha = false; for (let i = 0; i < pixels.length; i += 4) { if (pixels[i + 3] < 250) { pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b; pixels[i+3] = 255; hasAlpha = true; } else { pixels[i+3] = 0; } }
                                    if (hasAlpha) { mctx.putImageData(imgData, 0, 0); } node._lastClickPos = null; saveHistory(); URL.revokeObjectURL(blobUrl); updateUI(true);
                                };
                                tempImg.src = blobUrl;
                            }).catch(e => console.error("TrixLoader Mask Intercept Error:", e));
                        } else {
                            node._baseImageName = currentVal; 
                            setTimeout(() => { if (node.updateUIRef) node.updateUIRef(true); }, 50);
                        }
                        if (node.refreshImagePickerRef) node.refreshImagePickerRef();
                    };
                }

                const pasteHandler = async (e) => {
                    const selectedNodes = app.canvas ? app.canvas.selected_nodes : null;
                    const isHovered = !!(wrapper.matches && wrapper.matches(":hover"));
                    const hasFocusInside = !!(document.activeElement && wrapper.contains(document.activeElement));
                    const isSelected = !!(
                        node.isSelected ||
                        isHovered ||
                        hasFocusInside ||
                        (selectedNodes && selectedNodes[node.id]) ||
                        (Array.isArray(selectedNodes) && selectedNodes.includes(node))
                    );
                    if (!isSelected) return;

                    const clipboard = e.clipboardData || (e.originalEvent && e.originalEvent.clipboardData);
                    const items = clipboard && clipboard.items ? Array.from(clipboard.items) : [];
                    const imageItem = items.find((item) => item.kind === "file" && item.type && item.type.startsWith("image/"));
                    if (!imageItem) return;

                    e.preventDefault();
                    e.stopPropagation();
                    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

                    const file = imageItem.getAsFile ? imageItem.getAsFile() : null;
                    if (!file) return;

                    const filename = trixAioFilename("paste", node.id, file.name, imageItem.type || file.type);
                    const newFile = new File([file], filename, { type: file.type || imageItem.type || "image/png" });
                    const body = new FormData();
                    body.append("image", newFile, filename);
                    trixAppendAioUploadFields(body);

                    try {
                        const resp = await fetch("/upload/image", { method: "POST", body: body });
                        if (resp.status === 200) {
                            const data = await resp.json();
                            const finalName = trixAioFullPath(data);
                            if (imgWidget) {
                                imgWidget.value = finalName;
                                if (imgWidget.callback) imgWidget.callback(finalName);
                            }
                        }
                    } catch (err) {
                        console.error("TrixLoader Paste Error:", err);
                    }
                };

                window.addEventListener("paste", pasteHandler, { capture: true });
                document.addEventListener("paste", pasteHandler, { capture: true });
                const onRemoved = node.onRemoved; node.onRemoved = function() { 
                    if (wrapper.parentNode === document.body) { document.body.removeChild(wrapper); }
                    window.removeEventListener("paste", pasteHandler, true);
                    document.removeEventListener("paste", pasteHandler, true); 
                    window.removeEventListener("resize", node._onResizeWindow); 
                    window.removeEventListener("keydown", node._onKeydownWindow); 
                    window.removeEventListener("pointerup", node._pointerUpHandler, { capture: true });
                    document.removeEventListener("dragover", documentDragOverHandler, { capture: true });
                    document.removeEventListener("drop", documentDropHandler, { capture: true });
                    document.removeEventListener("visibilitychange", node._onVisChange);
                    if (node.imgTagRef) node.imgTagRef.src = ""; if (node.tempHistoryImg) node.tempHistoryImg.src = ""; node.history = [];
                    if (onRemoved) onRemoved.apply(this, arguments); 
                };

                let dirtyCanvasPending = false;
                node.requestDirtyCanvas = () => {
                    if (!dirtyCanvasPending && app.graph) {
                        dirtyCanvasPending = true;
                        requestAnimationFrame(() => {
                            if (app.graph) app.graph.setDirtyCanvas(true, true);
                            dirtyCanvasPending = false;
                        });
                    }
                };

                updateUI();
            };

            const origOnDrawForeground = nodeType.prototype.onDrawForeground;
            nodeType.prototype.onDrawForeground = function(ctx) {
                if (!Object.getOwnPropertyDescriptor(this, "color") || Object.getOwnPropertyDescriptor(this, "color").get === undefined) {
                    Object.defineProperty(this, "color", {
                        get: function() { return TRIX_NODE_OUTLINE; },
                        set: function(v) {},
                        configurable: true,
                        enumerable: true
                    });
                }
                if (!Object.getOwnPropertyDescriptor(this, "bgcolor") || Object.getOwnPropertyDescriptor(this, "bgcolor").get === undefined) {
                    Object.defineProperty(this, "bgcolor", {
                        get: function() { return TRIX_BG; },
                        set: function(v) {},
                        configurable: true,
                        enumerable: true
                    });
                }
                if (origOnDrawForeground) origOnDrawForeground.apply(this, arguments);

                if (!this.flags.collapsed && this.drawTrixPreview) {
                    this.drawTrixPreview(ctx, true);
                }

                const titleHeight = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_TITLE_HEIGHT) ? LiteGraph.NODE_TITLE_HEIGHT : 30;
                const nodeRadius = (typeof LiteGraph !== "undefined" && Number.isFinite(LiteGraph.ROUND_RADIUS)) ? LiteGraph.ROUND_RADIUS : TRIX_NODE_RADIUS;
                ctx.save();
                ctx.strokeStyle = this._trixDropActive ? TRIX_ACCENT : TRIX_NODE_OUTLINE;
                ctx.lineWidth = 1;
                drawRoundedNodeStroke(ctx, 0.5, -titleHeight + 0.5, this.size[0] - 1, this.size[1] + titleHeight - 1, nodeRadius);
                ctx.restore();
                
                if (!this.flags.collapsed) {
                    ctx.save();
                    ctx.fillStyle = "#00bfff";
                    ctx.font = "bold 16px sans-serif";
                    ctx.textAlign = "right";
                    ctx.fillText("?", this.size[0] - 12, -8);
                    ctx.restore();
                }
            };

            nodeType.prototype.onConnectionsChange = function(type, index, connected, link_info) { 
                if (this.inputs && this.inputs[index] && this.inputs[index].name === "in_image") { 
                    if (!connected) {
                        this._currentLiveUrl = null;
                        if (this.widgets) {
                            const myImgWidget = this.widgets.find(w => w.name === "image");
                            if (myImgWidget && myImgWidget.callback && myImgWidget.value) {
                                myImgWidget.callback(myImgWidget.value);
                            }
                        }
                    } else {
                        if (this.pullLivePreviewRef) this.pullLivePreviewRef();
                    }
                    refreshTrixOutputs(this);
                    if (this.updateUIRef) this.updateUIRef(); 
                } 
            };

            nodeType.prototype.onExecuted = function(message) {
                const node = this;
                
                let incomingMaskName = null;
                if (message?.masks && message.masks.length > 0) {
                    incomingMaskName = message.masks[0];
                }

                if (message?.images && message.images.length > 0) {
                    const img_info = message.images[0]; 
                    const imgSubfolder = img_info.subfolder || "";
                    const url = `/view?filename=${encodeURIComponent(img_info.filename)}&type=${img_info.type}&subfolder=${encodeURIComponent(imgSubfolder)}&t=${Date.now()}`;
                    
                    const imgWidget = node.widgets ? node.widgets.find(w => w.name === "image") : null;
                    if (imgWidget && img_info.type === "input") {
                        imgWidget.value = imgSubfolder ? `${imgSubfolder}/${img_info.filename}` : img_info.filename;
                    }

                    if (node.imgTagRef) {
                        const originalOnload = node.imgTagRef.onload;
                        node.imgTagRef.onload = (e) => {
                            if (originalOnload) originalOnload(e);
                            
                            node.maskCanvasRef.width = node.imgTagRef.naturalWidth;
                            node.maskCanvasRef.height = node.imgTagRef.naturalHeight;
                            node.alignCanvasRef();
                            node.syncMaskToCanvas();
                            
                            if (incomingMaskName) {
                                setTimeout(() => {
                                    const mImg = new Image();
                                    mImg.onload = () => {
                                        const mctx = node.maskCanvasRef.getContext("2d", { willReadFrequently: true });
                                        const tcanvas = document.createElement('canvas');
                                        tcanvas.width = mImg.naturalWidth; tcanvas.height = mImg.naturalHeight;
                                        const tctx = tcanvas.getContext('2d', { willReadFrequently: true });
                                        tctx.drawImage(mImg, 0, 0);
                                        
                                        const imgData = tctx.getImageData(0, 0, tcanvas.width, tcanvas.height);
                                        const pixels = imgData.data;

                                        let r = 255, g = 0, b = 0;
                                        if (node.maskColor) {
                                            const hex = node.maskColor.replace("#", "");
                                            r = parseInt(hex.substring(0, 2), 16) || 255;
                                            g = parseInt(hex.substring(2, 4), 16) || 0;
                                            b = parseInt(hex.substring(4, 6), 16) || 0;
                                        }

                                        let hasAlpha = false;
                                        for (let i = 0; i < pixels.length; i += 4) {
                                            const maskVal = pixels[i]; 
                                            if (maskVal > 5) { 
                                                pixels[i] = r;
                                                pixels[i+1] = g;
                                                pixels[i+2] = b;
                                                pixels[i+3] = maskVal; 
                                                hasAlpha = true;
                                            } else {
                                                pixels[i+3] = 0;
                                            }
                                        }
                                        
                                        mctx.globalCompositeOperation = "source-over";
                                        if (hasAlpha) {
                                            tctx.putImageData(imgData, 0, 0);
                                            mctx.drawImage(tcanvas, 0, 0);
                                            
                                            if (node.widgets) {
                                                const mData = node.widgets.find(w => w.name === "mask_data");
                                                if (mData) mData.value = node.maskCanvasRef.toDataURL();
                                            }
                                        }
                                        
                                        // Reset history because image size may have changed!
                                        node.history = [];
                                        node.historyIndex = -1;
                                        if (node.saveHistoryRef) node.saveHistoryRef();
                                        
                                        if (node.alignCanvasRef) node.alignCanvasRef();
                                        if (node.updateUIRef) node.updateUIRef();
                                        if (app.graph) app.graph.setDirtyCanvas(true, true);
                                    };
                                    mImg.src = `/view?filename=${encodeURIComponent(incomingMaskName.filename)}&type=${incomingMaskName.type}&subfolder=${encodeURIComponent(incomingMaskName.subfolder || "")}&t=${Date.now()}`;
                                }, 1000); 
                            }

                            if (app.graph) app.graph.setDirtyCanvas(true, true); 
                            if (node.updateUIRef) node.updateUIRef(); 
                            
                            // Restore original onload to prevent infinite wrapping if executed multiple times
                            node.imgTagRef.onload = originalOnload;
                        };
                        node.imgTagRef.src = url;
                    }
                } else if (incomingMaskName) {
                    setTimeout(() => {
                        const mImg = new Image();
                        mImg.onload = () => {
                            const mctx = node.maskCanvasRef.getContext("2d", { willReadFrequently: true });
                            const tcanvas = document.createElement('canvas');
                            tcanvas.width = mImg.naturalWidth; tcanvas.height = mImg.naturalHeight;
                            const tctx = tcanvas.getContext('2d', { willReadFrequently: true });
                            tctx.drawImage(mImg, 0, 0);
                            
                            const imgData = tctx.getImageData(0, 0, tcanvas.width, tcanvas.height);
                            const pixels = imgData.data;

                            let r = 255, g = 0, b = 0;
                            if (node.maskColor) {
                                const hex = node.maskColor.replace("#", "");
                                r = parseInt(hex.substring(0, 2), 16) || 255;
                                g = parseInt(hex.substring(2, 4), 16) || 0;
                                b = parseInt(hex.substring(4, 6), 16) || 0;
                            }

                            let hasAlpha = false;
                            for (let i = 0; i < pixels.length; i += 4) {
                                const maskVal = pixels[i]; 
                                if (maskVal > 5) { 
                                    pixels[i] = r;
                                    pixels[i+1] = g;
                                    pixels[i+2] = b;
                                    pixels[i+3] = maskVal;
                                    hasAlpha = true;
                                } else {
                                    pixels[i+3] = 0;
                                }
                            }
                            
                            mctx.globalCompositeOperation = "source-over";
                            if (hasAlpha) {
                                tctx.putImageData(imgData, 0, 0);
                                mctx.drawImage(tcanvas, 0, 0);
                                
                                if (node.widgets) {
                                    const mData = node.widgets.find(w => w.name === "mask_data");
                                    if (mData) mData.value = node.maskCanvasRef.toDataURL();
                                }
                            }
                            
                            if (node.saveHistoryRef) node.saveHistoryRef();
                            if (node.alignCanvasRef) node.alignCanvasRef();
                            if (node.updateUIRef) node.updateUIRef();
                            if (app.graph) app.graph.setDirtyCanvas(true, true);
                        };
                        mImg.src = `/view?filename=${encodeURIComponent(incomingMaskName.filename)}&type=${incomingMaskName.type}&subfolder=${encodeURIComponent(incomingMaskName.subfolder || "")}&t=${Date.now()}`;
                    }, 1000); 
                }
            };
        }
    },
    nodeCreated(node) {
        if (node.comfyClass === "TrixLoadImageAIO") {
            try {
                applyTrixNodeChrome(node);
                refreshTrixOutputs(node);
                if (!node.title || node.title.toLowerCase().includes("load image aio")) {
                    node.title = TRIX_DISPLAY_TITLE;
                }
                if (node.updateUIRef) {
                    node.updateUIRef();
                }
                if (node.syncHTMLRef) {
                    node.syncHTMLRef();
                }
            } catch (err) {
                console.error("TrixLoader nodeCreated error:", err);
            }
        }
    }
});


