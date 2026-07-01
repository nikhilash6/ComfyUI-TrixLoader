import { app } from '../../../scripts/app.js';
import { openTrixCamrawBox } from './camraw_box.js';
import { openTrixMaskBox } from './mask_box.js';
import { openTrixCropBox } from './crop_box.js';

// Helper to get the currently selected node fallback if selectedItem is undefined
function getSelectedNode(selectedItem) {
    if (selectedItem) return selectedItem;
    if (app.canvas?.selected_nodes && app.canvas.selected_nodes.length > 0) {
        return app.canvas.selected_nodes[0];
    }
    if (app.canvas?.selectedItems && app.canvas.selectedItems.size > 0) {
        return Array.from(app.canvas.selectedItems)[0];
    }
    return null;
}

// Helper to get image element and widget from node
function trixGetNodeImageInfo(node) {
    if (!node) return { srcImg: null, imgWidget: null };
    let srcImg = null;
    if (node.image && node.image.complete && node.image.naturalWidth > 0) {
        srcImg = node.image;
    } else if (node.imgs && node.imgs.length > 0) {
        const firstImg = node.imgs[0];
        if (firstImg && firstImg.complete && firstImg.naturalWidth > 0) {
            srcImg = firstImg;
        }
    } else if (node.imgTagRef && node.imgTagRef.complete && node.imgTagRef.naturalWidth > 0) {
        srcImg = node.imgTagRef;
    }

    const imgWidget = node.widgets?.find(w => w && (w.name === "image" || w.name === "image_path"));
    return { srcImg, imgWidget };
}

// Extracts a grayscale mask canvas (white = mask, black = no mask) from image alpha channel
function extractMaskFromImage(srcImg) {
    if (!srcImg || !srcImg.naturalWidth) return null;
    const w = srcImg.naturalWidth;
    const h = srcImg.naturalHeight;

    const cvs = document.createElement("canvas");
    cvs.width = w;
    cvs.height = h;
    const ctx = cvs.getContext("2d");
    ctx.drawImage(srcImg, 0, 0);

    try {
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;
        let hasAlpha = false;

        // Check if there are any transparent/masked pixels
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 255) {
                hasAlpha = true;
                break;
            }
        }

        if (!hasAlpha) return null;

        // Create grayscale mask (white where transparent/masked, black where opaque/unmasked)
        const maskCvs = document.createElement("canvas");
        maskCvs.width = w;
        maskCvs.height = h;
        const maskCtx = maskCvs.getContext("2d");
        const maskData = maskCtx.createImageData(w, h);

        for (let i = 0; i < data.length; i += 4) {
            const maskVal = 255 - data[i + 3];
            maskData.data[i] = maskVal;
            maskData.data[i + 1] = maskVal;
            maskData.data[i + 2] = maskVal;
            maskData.data[i + 3] = 255;
        }
        maskCtx.putImageData(maskData, 0, 0);
        return maskCvs;
    } catch (e) {
        console.error("Failed to extract mask from image:", e);
        return null;
    }
}

// Preloads the image from the node and extracts the mask before calling the editor callback
function preloadAndExecute(node, callback) {
    const { srcImg, imgWidget } = trixGetNodeImageInfo(node);
    
    const execute = (img) => {
        const maskCanvas = extractMaskFromImage(img);
        callback(node, img, maskCanvas);
    };

    if (srcImg && srcImg.complete && srcImg.naturalWidth > 0) {
        execute(srcImg);
    } else if (imgWidget && imgWidget.value) {
        const tempImg = new Image();
        tempImg.crossOrigin = "anonymous";
        tempImg.onload = () => execute(tempImg);
        tempImg.onerror = () => alert("Failed to load node image for editing.");
        
        let type = "input";
        if (imgWidget.options && imgWidget.options.type) {
            type = imgWidget.options.type;
        }
        tempImg.src = `/view?filename=${encodeURIComponent(imgWidget.value)}&type=${type}&t=${Date.now()}`;
    } else {
        alert("No image found on this node to edit.");
    }
}

// Register the ComfyUI Toolbox extension
app.registerExtension({
    name: "Trix.Toolbox",
    commands: [
        {
            id: "trix.mask_box",
            label: "trx adv. mask editor",
            icon: "trix-icon-mask",
            tooltip: "trx adv. mask editor",
            description: "trx adv. mask editor",
            function: (selectedItem) => {
                const node = getSelectedNode(selectedItem);
                if (!node) return;
                preloadAndExecute(node, openTrixMaskBox);
            }
        },
        {
            id: "trix.camraw_box",
            label: "trx adv. camera raw",
            icon: "trix-icon-camraw",
            tooltip: "trx adv. camera raw",
            description: "trx adv. camera raw",
            function: (selectedItem) => {
                const node = getSelectedNode(selectedItem);
                if (!node) return;
                preloadAndExecute(node, openTrixCamrawBox);
            }
        },
        {
            id: "trix.crop_box",
            label: "trx adv. crop/pad/outpaint",
            icon: "trix-icon-crop",
            tooltip: "trx adv. crop/pad/outpaint",
            description: "trx adv. crop/pad/outpaint",
            function: (selectedItem) => {
                const node = getSelectedNode(selectedItem);
                if (!node) return;
                preloadAndExecute(node, openTrixCropBox);
            }
        }
    ],
    getSelectionToolboxCommands(selectedItem) {
        const node = getSelectedNode(selectedItem);
        if (!node) return [];
        
        // Skip TrixLoadImageAIO as they are already embedded inside it
        if (node.type === "TrixLoadImageAIO" || node.comfyClass === "TrixLoadImageAIO") {
            return [];
        }

        // We target any node that has an image widget or active preview image
        const { srcImg, imgWidget } = trixGetNodeImageInfo(node);

        if (srcImg || imgWidget) {
            const activeCmds = [];
            const showMask = app.ui.settings.getSettingValue("Trix AIO Tools.Toolbox.AdvMask", true);
            const showCamraw = app.ui.settings.getSettingValue("Trix AIO Tools.Toolbox.AdvCamraw", true);
            const showCrop = app.ui.settings.getSettingValue("Trix AIO Tools.Toolbox.AdvCrop", true);
            
            if (showMask) activeCmds.push("trix.mask_box");
            if (showCamraw) activeCmds.push("trix.camraw_box");
            if (showCrop) activeCmds.push("trix.crop_box");

            const orderStr = app.ui.settings.getSettingValue("Trix AIO Tools.Toolbox.Order", "trix.mask_box,trix.camraw_box,trix.crop_box") || "trix.mask_box,trix.camraw_box,trix.crop_box";
            const orderArr = orderStr.split(",").filter(Boolean);

            activeCmds.sort((a, b) => {
                let idxA = orderArr.indexOf(a);
                let idxB = orderArr.indexOf(b);
                if (idxA === -1) idxA = 999;
                if (idxB === -1) idxB = 999;
                return idxA - idxB;
            });
            return activeCmds;
        }

        return [];
    },
    setup() {
        // 1. Inject custom icon CSS
        if (!document.getElementById("trix-toolbox-icons-css")) {
            const style = document.createElement("style");
            style.id = "trix-toolbox-icons-css";
            style.textContent = `
                .trix-icon-mask, .trix-icon-camraw, .trix-icon-crop {
                    font-style: normal;
                    font-weight: bold;
                    display: inline-block;
                    font-family: inherit;
                    line-height: 1;
                    text-align: center;
                    font-size: 18px;
                    width: 18px;
                    height: 18px;
                    vertical-align: middle;
                }
                .trix-icon-mask::before {
                    content: "✦";
                }
                .trix-icon-camraw::before {
                    content: "◩";
                }
                .trix-icon-crop::before {
                    content: "⛶";
                }
            `;
            document.head.appendChild(style);
        }

        // 2. Set up tooltips MutationObserver
        const updateTooltips = () => {
            const mappings = [
                { selector: ".trix-icon-mask", text: "trx adv. mask editor" },
                { selector: ".trix-icon-camraw", text: "trx adv. camera raw" },
                { selector: ".trix-icon-crop", text: "trx adv. crop/pad/outpaint" }
            ];
            for (const map of mappings) {
                const els = document.querySelectorAll(map.selector);
                for (const el of els) {
                    el.title = map.text;
                    const btn = el.closest("button") || el.parentElement;
                    if (btn && btn.title !== map.text) {
                        btn.title = map.text;
                    }
                }
            }
        };

        const observer = new MutationObserver(updateTooltips);
        observer.observe(document.body, { childList: true, subtree: true });
        
        updateTooltips();
        setInterval(updateTooltips, 1500);

        // 3. Selection toolbar DOM elements reordering observer
        function getElementKey(el) {
            if (el.innerText === "|" || el.classList.contains("separator") || el.classList.contains("divider") || el.style.borderLeft || el.style.borderRight || el.style.width === "1px") {
                return "divider";
            }
            
            const iEl = el.querySelector("i, span, svg");
            const classStr = el.className + " " + (iEl ? iEl.className : "");
            const textStr = el.innerText || "";
            
            if (classStr.includes("trix-icon-mask") || textStr.includes("✦")) return "trix.mask_box";
            if (classStr.includes("trix-icon-camraw") || textStr.includes("◩")) return "trix.camraw_box";
            if (classStr.includes("trix-icon-crop") || textStr.includes("⛶")) return "trix.crop_box";
            
            if (classStr.includes("trash") || classStr.includes("delete") || textStr.includes("🗑")) return "delete";
            if (classStr.includes("info") || textStr.includes("ⓘ")) return "info";
            if (classStr.includes("undo") || textStr.includes("↶")) return "undo";
            if (classStr.includes("ellipsis") || classStr.includes("more") || textStr.includes("⋮")) return "more";
            
            if (classStr.includes("color") || el.querySelector("[style*='color']") || textStr.includes("⬤")) return "color";
            if (classStr.includes("sliders") || textStr.includes("🎛")) return "sliders";
            if (classStr.includes("pie") || textStr.includes("◔")) return "pie";
            
            return "unknown";
        }

        function findToolbarContainer(trixBtn) {
            let parent = trixBtn.parentElement;
            while (parent && parent !== document.body) {
                if (parent.querySelector(".pi-trash") || parent.querySelector("[class*='trash']") || parent.querySelector("[class*='delete']")) {
                    return parent;
                }
                parent = parent.parentElement;
            }
            return trixBtn.parentElement ? trixBtn.parentElement.parentElement : null;
        }

        function isToolbarInCorrectOrder(toolbar) {
            const orderStr = app.ui.settings.getSettingValue("Trix AIO Tools.Toolbox.Order", "trix.camraw_box,trix.mask_box,trix.crop_box") || "trix.camraw_box,trix.mask_box,trix.crop_box";
            const orderArr = orderStr.split(",").filter(Boolean);
            const shiftVal = parseInt(app.ui.settings.getSettingValue("Trix AIO Tools.Toolbox.Shift", 0), 10) || 0;
            
            const children = Array.from(toolbar.children);
            const currentKeys = children.map(getElementKey);
            
            const ourKeys = currentKeys.filter(k => k.startsWith("trix."));
            const standardKeys = currentKeys.filter(k => !k.startsWith("trix."));
            
            if (ourKeys.length === 0) return true;
            
            ourKeys.sort((a, b) => {
                let idxA = orderArr.indexOf(a);
                let idxB = orderArr.indexOf(b);
                if (idxA === -1) idxA = 999;
                if (idxB === -1) idxB = 999;
                return idxA - idxB;
            });
            
            const targetIndex = Math.min(shiftVal, standardKeys.length);
            const expectedKeys = [...standardKeys];
            expectedKeys.splice(targetIndex, 0, ...ourKeys);
            
            return currentKeys.join(",") === expectedKeys.join(",");
        }

        function applyToolbarOrdering(toolbar) {
            const orderStr = app.ui.settings.getSettingValue("Trix AIO Tools.Toolbox.Order", "trix.camraw_box,trix.mask_box,trix.crop_box") || "trix.camraw_box,trix.mask_box,trix.crop_box";
            const orderArr = orderStr.split(",").filter(Boolean);
            const shiftVal = parseInt(app.ui.settings.getSettingValue("Trix AIO Tools.Toolbox.Shift", 0), 10) || 0;
            
            const children = Array.from(toolbar.children);
            
            const ourTools = [];
            const standardTools = [];
            
            children.forEach(child => {
                const key = getElementKey(child);
                if (key.startsWith("trix.")) {
                    ourTools.push(child);
                } else {
                    standardTools.push(child);
                }
            });
            
            ourTools.sort((a, b) => {
                const keyA = getElementKey(a);
                const keyB = getElementKey(b);
                let idxA = orderArr.indexOf(keyA);
                let idxB = orderArr.indexOf(keyB);
                if (idxA === -1) idxA = 999;
                if (idxB === -1) idxB = 999;
                return idxA - idxB;
            });
            
            const targetIndex = Math.min(shiftVal, standardTools.length);
            standardTools.splice(targetIndex, 0, ...ourTools);
            
            standardTools.forEach(child => toolbar.appendChild(child));
        }

        const toolbarObserver = new MutationObserver(() => {
            const trixBtn = document.querySelector(".trix-icon-mask, .trix-icon-camraw, .trix-icon-crop");
            if (trixBtn) {
                const toolbar = findToolbarContainer(trixBtn);
                if (toolbar) {
                    if (isToolbarInCorrectOrder(toolbar)) {
                        return;
                    }
                    applyToolbarOrdering(toolbar);
                }
            }
        });
        toolbarObserver.observe(document.body, { childList: true, subtree: true });

        // 3. Context menu options are injected via trix_loader_ui.js to avoid conflicts
    }
});
