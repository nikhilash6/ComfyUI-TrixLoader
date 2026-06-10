import os
os.environ["ALBUMENTATIONS_DISABLE_VERSION_CHECK"] = "1"
os.environ["NO_ALBUMENTATIONS_UPDATE"] = "1"

# Pre-configure Hugging Face mirror if system locale is Russian
try:
    import locale
    loc = locale.getdefaultlocale()[0]
    if loc and loc.lower().startswith("ru"):
        os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
except Exception:
    pass

import torch
import numpy as np
import json
from PIL import Image, ImageOps, ImageFilter, ImageDraw, ImageEnhance
import folder_paths
import node_helpers
from io import BytesIO
from server import PromptServer 
import base64
import asyncio
from contextlib import nullcontext

class AnyType(str):
    def __ne__(self, __value: object) -> bool:
        return False
any_typ = AnyType("*")

class TrixLoadImageAIO:
    @classmethod
    def INPUT_TYPES(s):
        input_dir = folder_paths.get_input_directory()
        aio_dir = os.path.join(input_dir, "aio_input")
        if not os.path.exists(aio_dir):
            try:
                os.makedirs(aio_dir, exist_ok=True)
            except:
                pass
        
        valid_extensions = ('.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tiff', '.tif')
        
        files = [
            f for f in os.listdir(input_dir)
            if os.path.isfile(os.path.join(input_dir, f))
            and f.lower().endswith(valid_extensions)
            and not f.lower().startswith("aio_")
        ]
        
        if os.path.exists(aio_dir):
            aio_files = [f"aio_input/{f}" for f in os.listdir(aio_dir) if os.path.isfile(os.path.join(aio_dir, f)) and f.lower().endswith(valid_extensions)]
            files.extend(aio_files)
            
        return {
            "required": {
                "image": (sorted(files),),
                "width": ("INT", {"default": 1024, "min": 16, "max": 8192}),
                "height": ("INT", {"default": 1024, "min": 16, "max": 8192}),
                "pad_left": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
                "pad_top": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
                "pad_right": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
                "pad_bottom": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
                "upscale_method": (["nearest-exact", "bilinear", "area", "bicubic", "lanczos"], {"default": "nearest-exact"}),
                "keep_proportion": (["stretch", "resize", "scale_by", "pad", "pad_edge_pixel", "crop", "pad_for_outpainting"], {"default": "resize"}),
                "crop_position": (["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"], {"default": "center"}),
                "scale_by": ("FLOAT", {"default": 1.0, "min": 0.01, "max": 64.0, "step": 0.01}),
                "condition": (["always", "downscale if bigger", "upscale if smaller", "if bigger area", "if smaller area"], {"default": "always"}),
                "feathering": ("INT", {"default": 0, "min": 0, "max": 250, "step": 1}),
                "divisible_by": ("INT", {"default": 2, "min": 1, "max": 256, "step": 1}),
                "enable_resize": ("BOOLEAN", {"default": False}),
                "mode": (["Base", "Mask", "Resize"], {"default": "Base"}),
                "mask_data": ("STRING", {"default": ""}),
                "crop_data": ("STRING", {"default": "{}"}),
                
                # ==== Camera Raw Settings ====
                "cr_enable": ("BOOLEAN", {"default": False}),
                "cr_exp": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1}),
                "cr_cont": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1}),
                "cr_high": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1}),
                "cr_shad": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1}),
                "cr_white": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1}),
                "cr_black": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1}),
                "cr_temp": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1}),
                "cr_tint": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1}),
                "cr_colorfulness": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1}),
                "cr_sat": ("INT", {"default": 0, "min": -100, "max": 100, "step": 1}),
                "cr_tex": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1}),
                "cr_clar": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1}),
                "cr_dehz": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1}),
                "cr_grain": ("INT", {"default": 0, "min": 0, "max": 150, "step": 1}),
                "cr_sharp": ("INT", {"default": 0, "min": 0, "max": 150, "step": 1}),
                "cr_blur": ("INT", {"default": 0, "min": 0, "max": 150, "step": 1}),
                "cr_vignette": ("INT", {"default": 0, "min": 0, "max": 150, "step": 1}),
                
                # ==== HSL Settings ====
                "hsl_active": ("BOOLEAN", {"default": False}),
                "hsl_data": ("STRING", {"default": "{}"}),
                "curve_active": ("BOOLEAN", {"default": False}),
                "curve_data": ("STRING", {"default": "{}"}),
            },
            "optional": {
                "in_image": ("IMAGE",),
                "in_mask": ("MASK",),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID" 
            }
        }

    CATEGORY = "TrixLoader 🪬"
    DESCRIPTION = """TABS CONTROLS: 
❂ COLOR GRADING [BASE]
➥ Dbl-Click tab to open Camera Raw menu
➥ Toggle "Enable Filter" to unlock settings
➥ Click "Live Camera Raw" for visual adjustments

✎ MASKING [MASK]
➥ Dbl-Click tab: Fullscreen Mode
➥ Alt + RMB (Drag): Resize Brush & Hardness
➥ Object Selector (SAM): LMB to add points, RMB + Drag to exclude
➥ Mask Background: Automated AI background removal (with Alpha Matting)

回 RESIZING & CROPPING [RESIZE] 
➥ Toggle "Enable Resize" to unlock dimension settings
➥ Click "Open CPO Editor" for visual cropping/padding
➥ Crop Position: Click for interactive 5-direction grid
➥ pad_for_outpainting: LMB drag-to-adjust padding on 4 sides (L, T, R, B)

★ PRO TIP: Right-click the node to directly Copy/Paste Images and Masks!"""

    RETURN_TYPES = ("IMAGE", "MASK", "IMAGE")
    RETURN_NAMES = ("IMAGE", "MASK", "↓ original_input")
    FUNCTION = "process"
    OUTPUT_NODE = True

    @classmethod
    def VALIDATE_INPUTS(s, image, **kwargs):
        return True

    @staticmethod
    def rgb_to_hsl(rgb):
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        maxc = np.max(rgb, axis=-1)
        minc = np.min(rgb, axis=-1)
        l = (maxc + minc) / 2.0
        
        s = np.zeros_like(l)
        h = np.zeros_like(l)
        
        mask = maxc != minc
        d = np.zeros_like(l)
        d[mask] = maxc[mask] - minc[mask]
        
        denom = np.where(l > 0.5, 2.0 - maxc - minc, maxc + minc)
        denom = np.where(denom == 0, 1.0, denom) 
        s[mask] = d[mask] / denom[mask]
        
        idx_r = mask & (maxc == r)
        idx_g = mask & (maxc == g) & (~idx_r)
        idx_b = mask & (maxc == b) & (~idx_r) & (~idx_g)
        
        h[idx_r] = (g[idx_r] - b[idx_r]) / d[idx_r] + np.where(g[idx_r] < b[idx_r], 6.0, 0.0)
        h[idx_g] = (b[idx_g] - r[idx_g]) / d[idx_g] + 2.0
        h[idx_b] = (r[idx_b] - g[idx_b]) / d[idx_b] + 4.0
        
        h = (h / 6.0) * 360.0
        return np.stack([h, s, l], axis=-1)

    @staticmethod
    def hsl_to_rgb(hsl):
        h, s, l = hsl[..., 0] / 360.0, hsl[..., 1], hsl[..., 2]
        
        def hue_to_rgb(p, q, t):
            t = np.where(t < 0.0, t + 1.0, t)
            t = np.where(t > 1.0, t - 1.0, t)
            
            res = np.empty_like(t)
            m1 = t < 1.0/6.0
            m2 = (~m1) & (t < 0.5)
            m3 = (~m1) & (~m2) & (t < 2.0/3.0)
            m4 = (~m1) & (~m2) & (~m3)
            
            res[m1] = p[m1] + (q[m1] - p[m1]) * 6.0 * t[m1]
            res[m2] = q[m2]
            res[m3] = p[m3] + (q[m3] - p[m3]) * (2.0/3.0 - t[m3]) * 6.0
            res[m4] = p[m4]
            return res
            
        q = np.where(l < 0.5, l * (1.0 + s), l + s - l * s)
        p = 2.0 * l - q
        
        r = np.where(s == 0, l, hue_to_rgb(p, q, h + 1.0/3.0))
        g = np.where(s == 0, l, hue_to_rgb(p, q, h))
        b = np.where(s == 0, l, hue_to_rgb(p, q, h - 1.0/3.0))
        
        return np.stack([r, g, b], axis=-1)

    @staticmethod
    def build_curve_lut(points):
        default_points = [(0.0, 0.0), (255.0, 255.0)]
        parsed_points = []

        if isinstance(points, list):
            for p in points:
                if not isinstance(p, dict):
                    continue
                try:
                    x = float(p.get("x", 0))
                    y = float(p.get("y", 0))
                except Exception:
                    continue
                parsed_points.append((float(np.clip(x, 0, 255)), float(np.clip(y, 0, 255))))

        if len(parsed_points) < 2:
            parsed_points = default_points.copy()

        parsed_points.sort(key=lambda pt: pt[0])

        dedup_points = []
        for pt in parsed_points:
            if dedup_points and abs(dedup_points[-1][0] - pt[0]) < 1e-6:
                dedup_points[-1] = pt
            else:
                dedup_points.append(pt)
        parsed_points = dedup_points

        if parsed_points[0][0] > 0:
            parsed_points.insert(0, (0.0, parsed_points[0][1]))
        if parsed_points[-1][0] < 255:
            parsed_points.append((255.0, parsed_points[-1][1]))

        xs = np.array([p[0] for p in parsed_points], dtype=np.float32)
        ys = np.array([p[1] for p in parsed_points], dtype=np.float32)
        lut = np.interp(np.arange(256, dtype=np.float32), xs, ys)
        return np.clip(lut, 0, 255).astype(np.uint8)

    @staticmethod
    def curve_is_active(curve_state):
        if not isinstance(curve_state, dict):
            return False
        default_line = [(0, 0), (255, 255)]

        for ch in ["rgb", "r", "g", "b"]:
            points = curve_state.get(ch, [])
            if not isinstance(points, list) or len(points) < 2:
                continue
            normalized = []
            for p in points:
                if not isinstance(p, dict):
                    continue
                normalized.append((
                    int(np.clip(round(float(p.get("x", 0))), 0, 255)),
                    int(np.clip(round(float(p.get("y", 0))), 0, 255))
                ))
            normalized.sort(key=lambda pt: pt[0])
            if len(normalized) >= 2 and normalized != default_line:
                return True
        return False

    @staticmethod
    def apply_lightness_like_photoshop(lightness, delta):
        delta = np.clip(delta, -1.0, 1.0)
        positive = delta >= 0
        out = np.where(
            positive,
            lightness + (1.0 - lightness) * delta,
            lightness + lightness * delta
        )
        return np.clip(out, 0.0, 1.0)

    @staticmethod
    def apply_detail_pass(arr, radius, amount, midtone_only=False):
        if abs(amount) < 1e-6:
            return arr

        base_img = Image.fromarray(np.clip(arr * 255.0, 0, 255).astype(np.uint8))
        blur_img = base_img.filter(ImageFilter.GaussianBlur(radius=max(0.1, float(radius))))
        blur_arr = np.array(blur_img).astype(np.float32) / 255.0

        diff = arr - blur_arr
        if midtone_only:
            luma = np.dot(arr[..., :3], [0.2126, 0.7152, 0.0722])
            mask = 1.0 - np.clip(np.abs(luma - 0.5) * 2.0, 0.0, 1.0)
            mask = np.power(mask, 1.25)[..., None]
            diff = diff * mask

        arr = arr + diff * float(amount)
        return np.clip(arr, 0.0, 1.0)

    def apply_camera_raw(self, img, kwargs):
        if not kwargs.get("cr_enable", False):
            return img

        exp = kwargs.get("cr_exp", 0)
        cont = kwargs.get("cr_cont", 0)
        sat = kwargs.get("cr_sat", 0)
        sharp = kwargs.get("cr_sharp", 0)
        clar = kwargs.get("cr_clar", 0)
        tex = kwargs.get("cr_tex", 0)
        blur = kwargs.get("cr_blur", 0)
        
        high = kwargs.get("cr_high", 0)
        shad = kwargs.get("cr_shad", 0)
        white = kwargs.get("cr_white", 0)
        black = kwargs.get("cr_black", 0)
        temp = kwargs.get("cr_temp", 0)
        tint = kwargs.get("cr_tint", 0)
        colorfulness = kwargs.get("cr_colorfulness", 0)
        dehz = kwargs.get("cr_dehz", 0)
        grain = kwargs.get("cr_grain", 0)
        vignette = kwargs.get("cr_vignette", 0)

        needs_cr = any(v != 0 for v in [exp, high, shad, white, black, temp, tint, colorfulness, dehz, grain, vignette, cont, sat, sharp, clar, tex, blur])
        
        needs_hsl = kwargs.get("hsl_active", False) and kwargs.get("hsl_data", "{}") != "{}"
        hsl_state = {}
        if needs_hsl:
            try:
                hsl_state = json.loads(kwargs["hsl_data"])
                has_hsl_changes = hsl_state.get("colorize", False)
                if not has_hsl_changes:
                    for key in ["master", "reds", "yellows", "greens", "cyans", "blues", "magentas"]:
                        conf = hsl_state.get(key, {})
                        if conf.get("h", 0) != 0 or conf.get("s", 0) != 0 or conf.get("l", 0) != 0:
                            has_hsl_changes = True
                            break
                needs_hsl = has_hsl_changes
            except:
                needs_hsl = False

        needs_curve = kwargs.get("curve_active", False) and kwargs.get("curve_data", "{}") != "{}"
        curve_state = {}
        if needs_curve:
            try:
                curve_state = json.loads(kwargs.get("curve_data", "{}"))
                needs_curve = self.curve_is_active(curve_state)
            except:
                needs_curve = False

        if needs_cr or needs_hsl or needs_curve:
            arr = np.array(img.convert("RGB")).astype(np.float32) / 255.0
            
            if needs_cr:
                if temp != 0 or tint != 0:
                    arr[:,:,0] += temp / 200.0 + (tint * 2.0) / 400.0
                    arr[:,:,1] -= (tint * 2.0) / 400.0
                    arr[:,:,2] -= temp / 200.0 - (tint * 2.0) / 400.0

                luma = np.dot(arr[..., :3], [0.299, 0.587, 0.114])

                if exp != 0: 
                    mult = 2.0 ** (exp / 50.0)
                    arr = arr * mult
                    luma = luma * mult

                if shad != 0: 
                    shad_v = shad / 100.0
                    mask = np.clip((0.72 - luma) / 0.72, 0.0, 1.0)
                    mask = mask * mask * (3.0 - 2.0 * mask)
                    if shad_v >= 0:
                        lift = mask[..., None] * shad_v * 0.85
                        arr += (1.0 - arr) * lift
                    else:
                        darken = mask[..., None] * (-shad_v) * 0.8
                        arr *= (1.0 - darken)

                if high != 0:
                    mask = np.clip((luma - 0.5) / 0.5, 0, 1)
                    arr += arr * mask[..., None] * (high/100.0) * 0.5

                if white != 0:
                    arr += (arr ** 2) * (white/100.0) * 0.5

                if black != 0:
                    arr -= ((1.0 - arr) ** 2) * (black/100.0) * 0.5

                if cont != 0:
                    f = 1.0 + (cont / 100.0)
                    arr = (arr - 0.5) * f + 0.5

                if sat != 0:
                    luma_new = np.dot(arr[..., :3], [0.299, 0.587, 0.114])
                    arr = luma_new[..., None] + (arr - luma_new[..., None]) * (1.0 + sat/100.0)

                if colorfulness != 0:
                    luma_c = np.dot(arr[..., :3], [0.299, 0.587, 0.114])
                    max_color = np.max(arr[..., :3], axis=2, keepdims=True)
                    min_color = np.min(arr[..., :3], axis=2, keepdims=True)
                    sat_mask = 1.0 - (max_color - min_color)
                    arr[..., :3] = arr[..., :3] + (arr[..., :3] - luma_c[..., None]) * (colorfulness/100.0) * sat_mask

                if dehz != 0:
                    dehz_v = dehz / 150.0
                    luma_d = np.dot(arr[..., :3], [0.299, 0.587, 0.114])[..., None]
                    max_color = np.max(arr[..., :3], axis=2, keepdims=True)
                    min_color = np.min(arr[..., :3], axis=2, keepdims=True)
                    haze = np.clip(1.0 - (max_color - min_color) * 2.0, 0.0, 1.0)
                    mid = 1.0 - np.clip(np.abs(luma_d - 0.5) * 2.0, 0.0, 1.0)
                    weight = np.clip(0.35 + 0.65 * haze * mid, 0.0, 1.0)

                    if dehz_v > 0:
                        contrast = 1.0 + dehz_v * 0.9 * weight
                        arr = (arr - 0.5) * contrast + 0.5
                        neutral = np.mean(arr[..., :3], axis=2, keepdims=True)
                        sat_boost = dehz_v * 0.18 * weight
                        arr[..., :3] += (arr[..., :3] - neutral) * sat_boost
                    else:
                        soften = (-dehz_v) * 0.45 * weight
                        arr = (arr - 0.5) * (1.0 - soften) + 0.5

                if vignette > 0:
                    h_img, w_img = arr.shape[:2]
                    y_mesh, x_mesh = np.ogrid[:h_img, :w_img]
                    center_y, center_x = h_img / 2, w_img / 2
                    radius = np.sqrt((x_mesh - center_x)**2 + (y_mesh - center_y)**2)
                    max_radius = np.sqrt(center_x**2 + center_y**2)
                    vig_mask = 1.0 - np.clip((radius / max_radius - 0.3) * (vignette / 50.0), 0, 1)
                    arr = arr * vig_mask[..., None]

                if grain > 0:
                    noise = np.random.normal(0, grain/200.0, arr.shape)
                    arr += noise

            arr = np.clip(arr, 0.0, 1.0)
            
            if needs_hsl:
                hsl = self.rgb_to_hsl(arr)
                hh, ss, ll = hsl[..., 0], hsl[..., 1], hsl[..., 2]
                sat_strength = np.log(6.0)
                
                if hsl_state.get("colorize", False):
                    master = hsl_state.get("master", {"h":0, "s":0, "l":0})
                    h_val = master.get("h", 0)
                    if h_val < 0: h_val += 360
                    hh = np.full_like(hh, h_val)
                    ss = np.clip(0.5 + (master.get("s", 0) / 100.0), 0.0, 1.0)
                    ll = self.apply_lightness_like_photoshop(ll, master.get("l", 0) / 100.0)
                else:
                    master = hsl_state.get("master", {"h":0, "s":0, "l":0})
                    total_h_shift = np.full_like(hh, master.get("h", 0))
                    total_s_mult = np.full_like(ss, np.exp((master.get("s", 0) / 100.0) * sat_strength))
                    total_l_shift = np.full_like(ll, master.get("l", 0) / 100.0)
                    
                    for ch in ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas']:
                        if ch in hsl_state:
                            conf = hsl_state[ch]
                            if conf.get("h",0) == 0 and conf.get("s",0) == 0 and conf.get("l",0) == 0:
                                continue
                            
                            center = conf.get("center", 0)
                            width = conf.get("width", 60)
                            
                            diff = np.abs(hh - center)
                            diff = np.where(diff > 180, 360.0 - diff, diff)
                            half = max(5.0, width / 2.0)
                            falloff = max(12.0, half * 0.65)
                            
                            weight = np.zeros_like(hh)
                            m1 = diff <= half
                            m2 = (~m1) & (diff <= half + falloff)
                            
                            weight[m1] = 1.0
                            t = (diff[m2] - half) / falloff
                            weight[m2] = 0.5 * (1.0 + np.cos(np.pi * t))
                            
                            if np.any(weight > 0):
                                total_h_shift += conf.get("h",0) * weight
                                total_s_mult *= np.exp((conf.get("s",0) / 100.0) * sat_strength * weight)
                                total_l_shift += (conf.get("l",0) / 100.0) * weight
                                
                    hh = (hh + total_h_shift) % 360.0
                    hh = np.where(hh < 0, hh + 360.0, hh)
                    ss = np.clip(ss * total_s_mult, 0.0, 1.0)
                    ll = self.apply_lightness_like_photoshop(ll, total_l_shift)
                    
                hsl = np.stack([hh, ss, ll], axis=-1)
                arr = self.hsl_to_rgb(hsl)
                arr = np.clip(arr, 0.0, 1.0)

            if needs_curve:
                lut_rgb = self.build_curve_lut(curve_state.get("rgb", []))
                lut_r = self.build_curve_lut(curve_state.get("r", []))
                lut_g = self.build_curve_lut(curve_state.get("g", []))
                lut_b = self.build_curve_lut(curve_state.get("b", []))

                rgb = np.clip(np.round(arr[..., :3] * 255.0), 0, 255).astype(np.uint8)

                rgb[..., 0] = lut_rgb[rgb[..., 0]]
                rgb[..., 1] = lut_rgb[rgb[..., 1]]
                rgb[..., 2] = lut_rgb[rgb[..., 2]]

                rgb[..., 0] = lut_r[rgb[..., 0]]
                rgb[..., 1] = lut_g[rgb[..., 1]]
                rgb[..., 2] = lut_b[rgb[..., 2]]

                arr[..., :3] = rgb.astype(np.float32) / 255.0

            if tex != 0:
                arr = self.apply_detail_pass(arr, radius=0.9, amount=tex / 140.0, midtone_only=False)
            if clar != 0:
                arr = self.apply_detail_pass(arr, radius=2.0, amount=clar / 130.0, midtone_only=True)
            if sharp > 0:
                arr = self.apply_detail_pass(arr, radius=1.6, amount=sharp / 110.0, midtone_only=False)
            if blur > 0:
                blur_img = Image.fromarray(np.clip(arr * 255.0, 0, 255).astype(np.uint8))
                blur_img = blur_img.filter(ImageFilter.GaussianBlur(radius=blur / 10.0))
                arr = np.array(blur_img).astype(np.float32) / 255.0
                
            arr = np.clip(arr, 0.0, 1.0)
            img = Image.fromarray((arr * 255.0).astype(np.uint8))

        elif blur > 0:
            img = img.filter(ImageFilter.GaussianBlur(radius=blur / 10.0))

        return img

    def process(self, image, width, height, pad_left, pad_top, pad_right, pad_bottom, upscale_method, keep_proportion, scale_by, condition, feathering, divisible_by, enable_resize, mode, mask_data, crop_data="{}", hsl_data="{}", hsl_active=False, curve_data="{}", curve_active=False, crop_position="center", in_image=None, in_mask=None, unique_id=None, **kwargs):
        
        # Cleanup old trix_edited files for this node to save disk space
        if unique_id:
            try:
                import folder_paths
                input_dir = folder_paths.get_input_directory()
                aio_dir = os.path.join(input_dir, "aio_input")
                if os.path.exists(aio_dir):
                    safe_id = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in str(unique_id))
                    prefix = f"trix_edited_{safe_id}_"
                    current_filename = os.path.basename(image) if image else ""
                    for f in os.listdir(aio_dir):
                        if f.startswith(prefix) and f.endswith(".png") and f != current_filename:
                            try:
                                os.remove(os.path.join(aio_dir, f))
                            except Exception:
                                pass
            except Exception:
                pass

        ui_images = None
        fill_color = (127, 127, 127)
        if crop_data and crop_data != "{}":
            try:
                import json
                cdata = json.loads(crop_data)
                hex_color = cdata.get("pad_color", "#808080")
                if hex_color.startswith("#"):
                    hex_color = hex_color.lstrip('#')
                    if len(hex_color) == 6:
                        fill_color = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
            except Exception as e:
                pass
        file_name_full = "image.png"
        orig_image_tensor = None
        
        if in_image is not None:
            i = 255. * in_image[0].cpu().numpy()
            img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
            
            # Save original image as a separate variable before any resize/crop/base edits
            orig_image_tensor = None
            
            input_dir = folder_paths.get_input_directory()
            aio_dir = os.path.join(input_dir, "aio_input")
            os.makedirs(aio_dir, exist_ok=True)
            safe_unique_id = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in str(unique_id)) if unique_id else "preview"
            preview_filename = f"aio_wired_{safe_unique_id}.png"
            file_name_full = f"aio_input/{preview_filename}"
            
            img.save(os.path.join(aio_dir, preview_filename), compress_level=1)
            ui_images = [{"filename": preview_filename, "subfolder": "aio_input", "type": "input"}]
            
            if 'A' in img.getbands():
                alpha_channel = np.array(img.getchannel('A')).astype(np.float32) / 255.0
                file_mask_np = (1. - alpha_channel) * 255.0
                file_mask_img = Image.fromarray(file_mask_np.astype(np.uint8), mode="L")
            else:
                file_mask_img = Image.new("L", img.size, 0)
        else:
            input_dir = folder_paths.get_input_directory()
            
            # Resolve image path safely
            image_path = None
            if image:
                try:
                    image_path = folder_paths.get_annotated_filepath(image)
                except Exception:
                    pass
            
            # Check if file exists and is valid, otherwise fallback
            if not image_path or not os.path.exists(image_path) or os.path.isdir(image_path):
                fallback_image = None
                valid_extensions = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".gif"}
                
                # Check root of input directory first
                if os.path.exists(input_dir):
                    for f in os.listdir(input_dir):
                        f_path = os.path.join(input_dir, f)
                        if os.path.isfile(f_path) and os.path.splitext(f.lower())[1] in valid_extensions:
                            fallback_image = f
                            image_path = f_path
                            break
                
                # Check subdirectories if no image found in root
                if not fallback_image and os.path.exists(input_dir):
                    for root, dirs, files in os.walk(input_dir):
                        for f in files:
                            f_path = os.path.join(root, f)
                            if os.path.splitext(f.lower())[1] in valid_extensions:
                                fallback_image = os.path.relpath(f_path, input_dir)
                                image_path = f_path
                                break
                        if fallback_image:
                            break
                
                # If still no image found anywhere, create a gray placeholder
                if not image_path or not os.path.exists(image_path):
                    placeholder_path = os.path.join(input_dir, "trix_placeholder.png")
                    print(f"TrixLoader: No images found in input folder. Creating a placeholder image at {placeholder_path}")
                    try:
                        placeholder_img = Image.new("RGB", (512, 512), (128, 128, 128))
                        placeholder_img.save(placeholder_path)
                        image_path = placeholder_path
                        image = "trix_placeholder.png"
                    except Exception as e:
                        print(f"TrixLoader: Failed to create placeholder: {e}")
                else:
                    print(f"TrixLoader: Selected image '{image}' was not found. Loaded fallback image: '{fallback_image}'")
                    image = fallback_image
            
            if not image_path or not os.path.exists(image_path):
                raise FileNotFoundError("TrixLoader: No valid input image could be found or created.")

            img = node_helpers.pillow(Image.open, image_path)
            img = ImageOps.exif_transpose(img)
            
            # Save original image as a separate variable before any resize/crop/base edits
            orig_img = img.convert("RGB")
            orig_image_tensor = np.array(orig_img).astype(np.float32) / 255.0
            orig_image_tensor = torch.from_numpy(orig_image_tensor)[None,]
            
            if os.name == "nt":
                file_name_full = image_path.rsplit("\\", 1)[-1]
            else:
                file_name_full = image_path.rsplit("/", 1)[-1]
            
            if 'A' in img.getbands():
                alpha_channel = np.array(img.getchannel('A')).astype(np.float32) / 255.0
                file_mask_np = (1. - alpha_channel) * 255.0
                file_mask_img = Image.fromarray(file_mask_np.astype(np.uint8), mode="L")
            else:
                file_mask_img = Image.new("L", img.size, 0)

        if in_mask is not None:
            # Safe shape check to handle both 2D (H, W) and 3D (B, H, W) mask tensors
            if in_mask.ndim == 2:
                in_m = in_mask.cpu().numpy() * 255.0
            elif in_mask.ndim >= 3:
                in_m = in_mask[0].cpu().numpy() * 255.0
            else:
                in_m = in_mask.view(-1, in_mask.shape[-2], in_mask.shape[-1])[0].cpu().numpy() * 255.0
            base_mask_img = Image.fromarray(np.clip(in_m, 0, 255).astype(np.uint8), mode="L")
            if base_mask_img.size != img.size:
                base_mask_img = base_mask_img.resize(img.size, Image.NEAREST)
        else:
            base_mask_img = Image.new("L", img.size, 0)

        # Apply CPO Editor crop if crop_data is present
        if crop_data and crop_data != "{}":
            try:
                cdata = json.loads(crop_data)
                cx = int(cdata.get("x", 0))
                cy = int(cdata.get("y", 0))
                cw = int(cdata.get("w", img.size[0]))
                ch = int(cdata.get("h", img.size[1]))
                
                # Crop image if it matches original size (not cropped yet) or in_image is wired
                if img.size[0] > cw or img.size[1] > ch or in_image is not None:
                    pad_color = fill_color
                    cropped_img = Image.new("RGB", (cw, ch), pad_color)
                    cropped_img.paste(img, (-cx, -cy))
                    img = cropped_img
                
                # Crop base mask if present
                if in_mask is not None:
                    cropped_mask = Image.new("L", (cw, ch), 0)
                    cropped_mask.paste(base_mask_img, (-cx, -cy))
                    base_mask_img = cropped_mask
                else:
                    base_mask_img = Image.new("L", img.size, 0)
                    
                # Crop file mask if present
                if file_mask_img is not None:
                    cropped_file_mask = Image.new("L", (cw, ch), 0)
                    cropped_file_mask.paste(file_mask_img, (-cx, -cy))
                    file_mask_img = cropped_file_mask
            except Exception as e:
                print(f"TrixLoader: Error applying crop_data to image/mask: {e}")

        mask_combined_np = np.maximum(np.array(base_mask_img), np.array(file_mask_img))

        mask_png_b64 = None
        decont_png_b64 = None
        if mask_data:
            if mask_data.startswith("{"):
                try:
                    parsed = json.loads(mask_data)
                    mask_png_b64 = parsed.get("mask")
                    decont_png_b64 = parsed.get("decont_image")
                except Exception as e:
                    print(f"TrixLoader: Error parsing mask_data JSON: {e}")
            elif mask_data.startswith("data:image"):
                mask_png_b64 = mask_data

        if decont_png_b64:
            try:
                if decont_png_b64.startswith("data:image"):
                    base64_data = decont_png_b64.split(",")[1]
                    img_decont = Image.open(BytesIO(base64.b64decode(base64_data))).convert("RGB")
                else:
                    decont_path = folder_paths.get_annotated_filepath(decont_png_b64)
                    img_decont = Image.open(decont_path).convert("RGB")
                    
                if img_decont.size == img.size:
                    img = img_decont
                else:
                    img = img_decont.resize(img.size, Image.BILINEAR)
                print("TrixLoader: Applied color-decontaminated image from mask editor.")
            except Exception as e:
                print(f"TrixLoader: Error loading decontaminated image: {e}")

        if mask_png_b64 and mask_png_b64.startswith("data:image"):
            try:
                base64_data = mask_png_b64.split(",")[1]
                drawn_img = Image.open(BytesIO(base64.b64decode(base64_data))).convert("RGBA")
                if drawn_img.size != img.size:
                    drawn_img = drawn_img.resize(img.size, Image.BILINEAR)
                
                drawn_np = np.array(drawn_img)[:, :, 3].astype(np.uint8)
                mask_combined_np = np.maximum(mask_combined_np, drawn_np)
            except Exception as e:
                print(f"TrixLoader: Error applying drawn mask: {e}")
                
        mask_combined = Image.fromarray(mask_combined_np, mode="L")

        resample_filters = {
            "nearest-exact": Image.NEAREST, "bilinear": Image.BILINEAR,
            "area": Image.BOX, "bicubic": Image.BICUBIC, "lanczos": Image.LANCZOS
        }
        resample = resample_filters.get(upscale_method, Image.LANCZOS)

        if enable_resize:
            old_w, old_h = img.size
            
            if keep_proportion == "pad_for_outpainting":
                target_w = old_w + pad_left + pad_right
                target_h = old_h + pad_top + pad_bottom
                
                if divisible_by > 1:
                    rem_w = target_w % divisible_by
                    if rem_w != 0:
                        pad_right += divisible_by - rem_w
                        target_w += divisible_by - rem_w
                    rem_h = target_h % divisible_by
                    if rem_h != 0:
                        pad_bottom += divisible_by - rem_h
                        target_h += divisible_by - rem_h
                
                new_img = Image.new("RGB", (target_w, target_h), fill_color)
                new_img.paste(img, (pad_left, pad_top))
                img = new_img
                
                outpaint_mask = Image.new("L", (target_w, target_h), 255)
                draw = ImageDraw.Draw(outpaint_mask)
                
                grow = feathering * 2
                
                black_x1 = pad_left + (grow if pad_left > 0 else 0)
                black_y1 = pad_top + (grow if pad_top > 0 else 0)
                black_x2 = pad_left + old_w - (grow if pad_right > 0 else 0)
                black_y2 = pad_top + old_h - (grow if pad_bottom > 0 else 0)
                
                black_x1 = min(black_x1, pad_left + old_w)
                black_y1 = min(black_y1, pad_top + old_h)
                black_x2 = max(black_x2, pad_left)
                black_y2 = max(black_y2, pad_top)

                if black_x1 < black_x2 and black_y1 < black_y2:
                    draw.rectangle([black_x1, black_y1, black_x2 - 1, black_y2 - 1], fill=0)
                
                if feathering > 0:
                    outpaint_mask = outpaint_mask.filter(ImageFilter.GaussianBlur(radius=feathering))
                
                user_mask_canvas = Image.new("L", (target_w, target_h), 0)
                user_mask_canvas.paste(mask_combined, (pad_left, pad_top))
                
                final_mask_np = np.maximum(np.array(outpaint_mask), np.array(user_mask_canvas))
                mask_combined = Image.fromarray(final_mask_np)

            else:
                target_w, target_h = width, height
                
                if keep_proportion == "scale_by":
                    try:
                        scale = float(scale_by)
                    except Exception:
                        scale = 1.0
                    scale = max(0.01, min(64.0, scale))
                    target_w = max(1, round(old_w * scale))
                    target_h = max(1, round(old_h * scale))
                    new_w, new_h = target_w, target_h
                elif keep_proportion == "stretch":
                    new_w, new_h = target_w, target_h
                elif keep_proportion in ["resize", "pad", "pad_edge_pixel"]:
                    ratio = min(target_w / old_w, target_h / old_h)
                    new_w, new_h = max(1, round(old_w * ratio)), max(1, round(old_h * ratio))
                elif keep_proportion == "crop":
                    ratio = max(target_w / old_w, target_h / old_h)
                    new_w, new_h = max(1, round(old_w * ratio)), max(1, round(old_h * ratio))

                do_resize = True
                if keep_proportion != "scale_by":
                    if condition == "downscale if bigger" and old_w <= new_w and old_h <= new_h:
                        do_resize = False
                    elif condition == "upscale if smaller" and old_w >= new_w and old_h >= new_h:
                        do_resize = False
                    elif condition == "if bigger area" and (old_w * old_h) <= (new_w * new_h):
                        do_resize = False
                    elif condition == "if smaller area" and (old_w * old_h) >= (new_w * new_h):
                        do_resize = False

                if do_resize:
                    if keep_proportion in ["stretch", "scale_by"]:
                        img = img.resize((target_w, target_h), resample)
                        mask_combined = mask_combined.resize((target_w, target_h), Image.BILINEAR)
                        
                    elif keep_proportion == "resize":
                        img = img.resize((new_w, new_h), resample)
                        mask_combined = mask_combined.resize((new_w, new_h), Image.BILINEAR)
                        
                    elif keep_proportion == "pad":
                        img_resized = img.resize((new_w, new_h), resample)
                        img = Image.new("RGB", (target_w, target_h), fill_color)
                        paste_x, paste_y = (target_w - new_w) // 2, (target_h - new_h) // 2
                        img.paste(img_resized, (paste_x, paste_y))
                        
                        mask_resized = mask_combined.resize((new_w, new_h), Image.BILINEAR)
                        mask_combined = Image.new("L", (target_w, target_h), 0)
                        mask_combined.paste(mask_resized, (paste_x, paste_y))
                        
                    elif keep_proportion == "pad_edge_pixel":
                        img_resized = img.resize((new_w, new_h), resample)
                        img_np = np.array(img_resized.convert("RGB"))
                        
                        pad_top = (target_h - new_h) // 2
                        pad_bottom = target_h - new_h - pad_top
                        pad_left = (target_w - new_w) // 2
                        pad_right = target_w - new_w - pad_left
                        
                        img_np = np.pad(img_np, ((pad_top, pad_bottom), (pad_left, pad_right), (0, 0)), mode='edge')
                        img = Image.fromarray(img_np)
                        
                        mask_resized = mask_combined.resize((new_w, new_h), Image.BILINEAR)
                        mask_np = np.pad(np.array(mask_resized), ((pad_top, pad_bottom), (pad_left, pad_right)), mode='constant', constant_values=0)
                        mask_combined = Image.fromarray(mask_np)
                        
                    elif keep_proportion == "crop":
                        img_resized = img.resize((new_w, new_h), resample)
                        mask_resized = mask_combined.resize((new_w, new_h), Image.BILINEAR)
                        
                        if crop_position == "top-left":
                            left = 0
                            top = 0
                        elif crop_position == "top":
                            left = (new_w - target_w) // 2
                            top = 0
                        elif crop_position == "top-right":
                            left = new_w - target_w
                            top = 0
                        elif crop_position == "left":
                            left = 0
                            top = (new_h - target_h) // 2
                        elif crop_position == "center":
                            left = (new_w - target_w) // 2
                            top = (new_h - target_h) // 2
                        elif crop_position == "right":
                            left = new_w - target_w
                            top = (new_h - target_h) // 2
                        elif crop_position == "bottom-left":
                            left = 0
                            top = new_h - target_h
                        elif crop_position == "bottom":
                            left = (new_w - target_w) // 2
                            top = new_h - target_h
                        elif crop_position == "bottom-right":
                            left = new_w - target_w
                            top = new_h - target_h
                        else:
                            left = (new_w - target_w) // 2
                            top = (new_h - target_h) // 2

                        right = left + target_w
                        bottom = top + target_h
                        
                        if right > new_w:
                            left -= (right - new_w)
                        if left < 0:
                            left = 0
                        if bottom > new_h:
                            top -= (bottom - new_h)
                        if top < 0:
                            top = 0
                        
                        img = img_resized.crop((left, top, right, bottom))
                        mask_combined = mask_resized.crop((left, top, right, bottom))

                if divisible_by > 1 and (img.size[0] % divisible_by != 0 or img.size[1] % divisible_by != 0):
                    curr_w, curr_h = img.size
                    x = (curr_w % divisible_by) // 2
                    y = (curr_h % divisible_by) // 2
                    x2 = curr_w - ((curr_w % divisible_by) - x)
                    y2 = curr_h - ((curr_h % divisible_by) - y)
                    img = img.crop((x, y, x2, y2))
                    mask_combined = mask_combined.crop((x, y, x2, y2))

        output_image = img.convert("RGB")
        
        # Обновляем kwargs новыми данными, так как ComfyUI передает их напрямую
        kwargs["hsl_data"] = hsl_data
        kwargs["hsl_active"] = hsl_active
        kwargs["curve_data"] = curve_data
        kwargs["curve_active"] = curve_active
        
        output_image = self.apply_camera_raw(output_image, kwargs)
        
        output_image = np.array(output_image).astype(np.float32) / 255.0
        output_image = torch.from_numpy(output_image)[None,]
        
        mask_out = np.array(mask_combined).astype(np.float32) / 255.0
        mask_out = torch.from_numpy(mask_out)[None,]

        final_result = (output_image, mask_out, orig_image_tensor)

        if unique_id is not None and ui_images:
            payload = {"id": unique_id}
            if ui_images: payload["images"] = ui_images
            PromptServer.instance.send_sync("trix-update-preview", payload)
        
        ui_return = {}
        if ui_images: ui_return["images"] = ui_images

        if ui_return:
            return {"ui": ui_return, "result": final_result}
        else:
            return {"result": final_result}

    @classmethod
    def IS_CHANGED(s, **kwargs):
        return float("NaN")

# ==============================================================================
# TRIXLOADER HTTP API ROUTES FOR ADVANCED MASK EDITOR
# ==============================================================================
from aiohttp import web
import urllib.request
import threading
import traceback
import gc
import shutil
import ssl

_ACTIVE_DOWNLOADS = {}
_ACTIVE_DOWNLOADS_LOCK = threading.Lock()

# New model weights Hugging Face URLs (indexed by weights filename)
MODEL_URLS = {
    "sam2.1_hiera_tiny-fp16.safetensors": "https://huggingface.co/Kijai/sam2-safetensors/resolve/main/sam2.1_hiera_tiny-fp16.safetensors",
    "sam2.1_hiera_large-fp16.safetensors": "https://huggingface.co/Kijai/sam2-safetensors/resolve/main/sam2.1_hiera_large-fp16.safetensors",
    "sam3-fp16.safetensors": "https://huggingface.co/yolain/sam3-safetensors/resolve/main/sam3-fp16.safetensors",
    "groundingdino_swint_ogc.safetensors": "https://huggingface.co/IDEA-Research/grounding-dino-tiny/resolve/main/model.safetensors",
    "inspyrenet-bf16.safetensors": "https://huggingface.co/dummy9996/inspyrenet-bf16/resolve/main/inspyrenet.safetensors",
    "Ben2.safetensors": "https://huggingface.co/PramaLLC/BEN2/resolve/main/model.safetensors",
    "Birefnet-lite.safetensors": "https://huggingface.co/TheGuy444/BiRefNet-lite/resolve/main/model.safetensors",
    "Birefnet.safetensors": "https://huggingface.co/ezzdev/BiRefNet/resolve/main/model.safetensors",
    "BiRefNet_HR.safetensors": "https://huggingface.co/ZhengPeng7/BiRefNet_HR/resolve/main/model.safetensors",
    "BiRefNet-portrait.safetensors": "https://huggingface.co/ZhengPeng7/BiRefNet-portrait/resolve/main/model.safetensors",
    "birefnet_finetuned_toonout.pth": "https://huggingface.co/joelseytre/toonout/resolve/main/birefnet_finetuned_toonout.pth"
}

# Directories relative to ComfyUI models_dir
MODEL_FOLDERS = {
    "sam2.1_hiera_tiny-fp16.safetensors": "sams",
    "sam2.1_hiera_large-fp16.safetensors": "sams",
    "sam3-fp16.safetensors": "sams",
    "groundingdino_swint_ogc.safetensors": "grounding-dino",
    "inspyrenet-bf16.safetensors": "RMBG",
    "Ben2.safetensors": "RMBG",
    "Birefnet-lite.safetensors": "RMBG",
    "Birefnet.safetensors": "RMBG",
    "BiRefNet_HR.safetensors": "RMBG",
    "BiRefNet-portrait.safetensors": "RMBG",
    "birefnet_finetuned_toonout.pth": "RMBG"
}

_CURRENT_SAM3_STATE = None
_CURRENT_SAM3_IMAGE = None
_CURRENT_SAM3_DEVICE = None
_LOADED_MODELS = {}
_LOADED_MODELS_LOCK = threading.Lock()
_SAM_INFERENCE_LOCK = threading.Lock()

def offload_other_models(current_model_key):
    global _LOADED_MODELS, _CURRENT_SAM3_STATE, _CURRENT_SAM3_IMAGE, _CURRENT_SAM3_DEVICE
    _CURRENT_SAM3_STATE = None
    _CURRENT_SAM3_IMAGE = None
    _CURRENT_SAM3_DEVICE = None
    with _LOADED_MODELS_LOCK:
        offloaded = False
        for key, model_inst in list(_LOADED_MODELS.items()):
            if key != current_model_key:
                print(f"TrixLoader: Offloading model {key} to CPU...")
                try:
                    # Move model elements to CPU
                    if hasattr(model_inst, "to"):
                        model_inst.to("cpu")
                    elif isinstance(model_inst, tuple):
                        for part in model_inst:
                            if hasattr(part, "to"):
                                part.to("cpu")
                    elif hasattr(model_inst, "model") and hasattr(model_inst.model, "to"):
                        model_inst.model.to("cpu")
                    offloaded = True
                except Exception as e:
                    print(f"TrixLoader: Error offloading {key}: {e}")
                    
        if offloaded:
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            try:
                import comfy.model_management
                comfy.model_management.soft_empty_cache()
            except Exception:
                pass

def locale_is_ru():
    try:
        import locale
        loc = locale.getdefaultlocale()[0]
        if loc and loc.lower().startswith("ru"):
            return True
    except Exception:
        pass
    return False

def snapshot_download_with_progress(repo_id, local_dir, model_name, use_mirror=False):
    import time
    import threading
    import sys
    import os
    from huggingface_hub import snapshot_download
    
    if use_mirror:
        os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
        
    stop_event = threading.Event()
    expected_size = 690 * 1024 * 1024  # ~723,000,000 bytes (model.safetensors is 689MB + config/tokenizer files)
    
    def monitor():
        while not stop_event.is_set():
            time.sleep(0.5)
            current_size = 0
            if os.path.exists(local_dir):
                for root, dirs, files in os.walk(local_dir):
                    for file in files:
                        fp = os.path.join(root, file)
                        if os.path.exists(fp):
                            current_size += os.path.getsize(fp)
            
            percent = int((current_size / expected_size) * 100)
            percent = min(99, percent)
            
            # Print single-line progress to stdout
            sys.stdout.write(f"\rTrixLoader: Downloading '{model_name}': {percent}% ({current_size / (1024*1024):.1f} / {expected_size / (1024*1024):.1f} MB)")
            sys.stdout.flush()
            
            PromptServer.instance.send_sync("trix-download-progress", {
                "model_name": model_name,
                "progress": percent,
                "status": "downloading"
            })
            
    monitor_thread = threading.Thread(target=monitor, daemon=True)
    monitor_thread.start()
    
    try:
        os.makedirs(local_dir, exist_ok=True)
        snapshot_download(
            repo_id=repo_id,
            local_dir=local_dir,
            local_dir_use_symlinks=False,
            ignore_patterns=["*.bin", "*.pth"]
        )
    finally:
        stop_event.set()
        monitor_thread.join()
        
    # Finalize line output
    sys.stdout.write(f"\rTrixLoader: Downloading '{model_name}': 100% ({expected_size / (1024*1024):.1f} / {expected_size / (1024*1024):.1f} MB)\n")
    sys.stdout.flush()
    PromptServer.instance.send_sync("trix-download-progress", {
        "model_name": model_name,
        "progress": 100,
        "status": "completed",
        "save_path": local_dir
    })

def download_model_thread(url, dest_path, model_name, dest_dir):
    import urllib.request
    import ssl
    import os
    import sys
    import time
    import socket
    
    # Auto-detect if we should use HF mirror by default based on system locale
    use_mirror = False
    try:
        import locale
        loc = locale.getdefaultlocale()[0]
        if loc and loc.lower().startswith("ru"):
            use_mirror = True
    except Exception:
        pass
        
    if use_mirror:
        print("TrixLoader: Russian locale detected. Pre-configuring Hugging Face mirror (hf-mirror.com) for faster downloads.")
        os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
        
    print(f"TrixLoader: Starting download of '{model_name}' to {dest_path}")
    try:
        if model_name == "groundingdino_swint_ogc.safetensors":
            snapshot_download_with_progress(
                repo_id="IDEA-Research/grounding-dino-tiny",
                local_dir=dest_dir,
                model_name=model_name,
                use_mirror=use_mirror
            )
            return

        temp_dest = dest_path + ".tmp"
        context = ssl._create_unverified_context()
        
        # Determine if tqdm is available
        use_tqdm = False
        try:
            from tqdm import tqdm
            use_tqdm = True
        except ImportError:
            pass

        # Try up to 5 attempts, using mirror on failure or pre-emptively
        max_attempts = 5
        attempt = 0
        downloaded = 0
        total_size = 0
        
        current_url = url
        
        # Start with mirror immediately if Russian locale detected to avoid initial timeout
        if use_mirror and "huggingface.co" in current_url:
            current_url = current_url.replace("huggingface.co", "hf-mirror.com")
            print(f"TrixLoader: Redirecting download to mirror: {current_url}")

        while attempt < max_attempts:
            attempt += 1
            try:
                if os.path.exists(temp_dest):
                    downloaded = os.path.getsize(temp_dest)
                else:
                    downloaded = 0
                
                headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
                if downloaded > 0:
                    headers['Range'] = f"bytes={downloaded}-"
                    print(f"TrixLoader: Resuming download from byte {downloaded} (attempt {attempt}/{max_attempts})...")
                else:
                    print(f"TrixLoader: Initiating download (attempt {attempt}/{max_attempts})...")
                
                req = urllib.request.Request(current_url, headers=headers)
                
                with urllib.request.urlopen(req, context=context, timeout=30) as response:
                    status_code = response.getcode()
                    content_length = int(response.headers.get('content-length', 0))
                    
                    if status_code == 206:
                        if total_size <= 0:
                            total_size = downloaded + content_length
                        file_mode = 'ab'
                    else:
                        total_size = content_length
                        downloaded = 0
                        file_mode = 'wb'
                    
                    if total_size > 0:
                        print(f"TrixLoader: Total size: {total_size / (1024*1024):.2f} MB")
                    else:
                        print("TrixLoader: Total size unknown")
                    
                    block_size = 1024 * 1024 # 1 MB chunks
                    last_percent = -1
                    
                    t = None
                    if use_tqdm and total_size > 0:
                        t = tqdm(total=total_size, initial=downloaded, unit='B', unit_scale=True, desc=f"TrixLoader: Downloading {model_name}", miniters=1, file=sys.stdout)
                    
                    with open(temp_dest, file_mode) as f:
                        while True:
                            try:
                                buffer = response.read(block_size)
                            except (socket.timeout, TimeoutError) as e:
                                raise e
                            except Exception as read_err:
                                raise read_err
                            
                            if not buffer:
                                break
                            
                            f.write(buffer)
                            downloaded += len(buffer)
                            if t:
                                t.update(len(buffer))
                            
                            if total_size > 0:
                                percent = int((downloaded / total_size) * 100)
                                if percent != last_percent:
                                    last_percent = percent
                                    if not use_tqdm:
                                        sys.stdout.write(f"\rTrixLoader: Downloading '{model_name}': {percent}% ({downloaded / (1024*1024):.1f} / {total_size / (1024*1024):.1f} MB)")
                                        sys.stdout.flush()
                                    try:
                                        PromptServer.instance.send_sync("trix-download-progress", {
                                            "model_name": model_name,
                                            "progress": percent,
                                            "status": "downloading"
                                        })
                                    except Exception:
                                        pass
                            else:
                                if not use_tqdm:
                                    mb_downloaded = downloaded / (1024*1024)
                                    sys.stdout.write(f"\rTrixLoader: Downloading '{model_name}': {mb_downloaded:.1f} MB downloaded...")
                                    sys.stdout.flush()
                                    
                    if t:
                        t.close()
                    if not use_tqdm:
                        sys.stdout.write("\n")
                        sys.stdout.flush()
                        
                    if total_size > 0 and downloaded >= total_size:
                        break
                    elif total_size <= 0:
                        break
                        
            except Exception as e:
                print(f"\nTrixLoader: Download attempt {attempt} failed: {e}")
                if "huggingface.co" in current_url:
                    current_url = current_url.replace("huggingface.co", "hf-mirror.com")
                    print(f"TrixLoader: Switching to mirror for next attempt: {current_url}")
                    os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
                
                if attempt >= max_attempts:
                    raise e
                
                sleep_time = min(2 * attempt, 10)
                print(f"TrixLoader: Waiting {sleep_time}s before retrying...")
                time.sleep(sleep_time)

        print(f"TrixLoader: Download complete. Finalizing file...")
        if os.path.exists(dest_path):
            os.remove(dest_path)
        os.rename(temp_dest, dest_path)
        print(f"TrixLoader: Model successfully installed at: {dest_path}")
            
        if model_name == "inspyrenet-bf16.safetensors":
            print("TrixLoader: Pre-installing packages transparent-background and albumentations...")
            auto_pip_install("transparent-background")
            auto_pip_install("albumentations")
        
        elif model_name in ["Birefnet-lite.safetensors", "Birefnet.safetensors", "BiRefNet_HR.safetensors", "BiRefNet-portrait.safetensors", "birefnet_finetuned_toonout.pth"]:
            print("TrixLoader: Pre-caching BiRefNet config and remote code modules...")
            try:
                from transformers import AutoConfig
                BIREFNET_REPOS = {
                    "Birefnet-lite.safetensors": "ZhengPeng7/BiRefNet_lite",
                    "Birefnet.safetensors": "ZhengPeng7/BiRefNet",
                    "BiRefNet_HR.safetensors": "ZhengPeng7/BiRefNet_HR",
                    "BiRefNet-portrait.safetensors": "ZhengPeng7/BiRefNet-portrait",
                    "birefnet_finetuned_toonout.pth": "ZhengPeng7/BiRefNet"
                }
                repo_id = BIREFNET_REPOS.get(model_name, "ZhengPeng7/BiRefNet")
                config = AutoConfig.from_pretrained(repo_id, trust_remote_code=True)
                print(f"TrixLoader: Pre-caching of BiRefNet ({repo_id}) finished successfully.")
            except Exception as birefnet_err:
                print(f"TrixLoader BiRefNet caching warning: {birefnet_err}")
        
        elif model_name == "sam3-fp16.safetensors":
            print("TrixLoader: Installing SAM3 custom node and all required libraries...")
            current_dir = os.path.dirname(os.path.abspath(__file__))
            sam3_path = os.path.join(current_dir, "comfyui-easy-sam3")
            if not os.path.exists(sam3_path):
                custom_nodes_path = os.path.abspath(os.path.join(folder_paths.models_dir, "..", "custom_nodes"))
                sam3_path = os.path.join(custom_nodes_path, "comfyui-easy-sam3")
                if not os.path.exists(sam3_path):
                    try:
                        auto_install_custom_node(
                            "https://github.com/yolain/comfyui-easy-sam3/archive/refs/heads/main.zip",
                            "comfyui-easy-sam3",
                            parent_path=current_dir
                        )
                        sam3_path = os.path.join(current_dir, "comfyui-easy-sam3")
                    except Exception as e:
                        try:
                            auto_install_custom_node(
                                "https://github.com/yolain/comfyui-easy-sam3/archive/refs/heads/main.zip",
                                "comfyui-easy-sam3",
                                parent_path=custom_nodes_path
                            )
                            sam3_path = os.path.join(custom_nodes_path, "comfyui-easy-sam3")
                        except Exception as e2:
                            print(f"TrixLoader: Failed to install comfyui-easy-sam3 node: {e2}")
            
            sam3_deps = {
                "torchvision": "torchvision",
                "timm": "timm",
                "ftfy": "ftfy",
                "regex": "regex",
                "iopath": "iopath",
                "einops": "einops",
                "decord": "decord",
                "pycocotools": "pycocotools",
                "scipy": "scipy",
                "scikit-image": "skimage",
                "scikit-learn": "sklearn",
                "pandas": "pandas",
                "open-clip-torch": "open_clip"
            }
            for pip_name, import_name in sam3_deps.items():
                try:
                    __import__(import_name)
                except (ImportError, ModuleNotFoundError):
                    auto_pip_install(pip_name)
        
        try:
            PromptServer.instance.send_sync("trix-download-progress", {
                "model_name": model_name,
                "progress": 100,
                "status": "completed",
                "save_path": dest_path
            })
        except Exception:
            pass
    except Exception as e:
        print(f"TrixLoader download error for '{model_name}': {e}")
        traceback.print_exc()
        try:
            PromptServer.instance.send_sync("trix-download-progress", {
                "model_name": model_name,
                "progress": 0,
                "status": "failed",
                "error": str(e)
            })
        except Exception:
            pass
    finally:
        with _ACTIVE_DOWNLOADS_LOCK:
            if model_name in _ACTIVE_DOWNLOADS:
                del _ACTIVE_DOWNLOADS[model_name]

@PromptServer.instance.routes.get('/trix/model_status')
async def api_model_status(request):
    sam_dir = os.path.join(folder_paths.models_dir, "sams")
    dino_dir = os.path.join(folder_paths.models_dir, "grounding-dino")
    bg_dir = os.path.join(folder_paths.models_dir, "RMBG")
    
    sam_models = {
        "sam2.1_hiera_tiny-fp16.safetensors": os.path.exists(os.path.join(sam_dir, "sam2.1_hiera_tiny-fp16.safetensors")),
        "sam2.1_hiera_large-fp16.safetensors": os.path.exists(os.path.join(sam_dir, "sam2.1_hiera_large-fp16.safetensors")),
        "sam3-fp16.safetensors": os.path.exists(os.path.join(sam_dir, "sam3-fp16.safetensors")),
        "groundingdino_swint_ogc.safetensors": os.path.exists(os.path.join(dino_dir, "model.safetensors")) and os.path.exists(os.path.join(dino_dir, "config.json"))
    }
    
    bg_models = {
        "inspyrenet-bf16.safetensors": os.path.exists(os.path.join(bg_dir, "inspyrenet-bf16.safetensors")),
        "Ben2.safetensors": os.path.exists(os.path.join(bg_dir, "Ben2.safetensors")),
        "Birefnet-lite.safetensors": os.path.exists(os.path.join(bg_dir, "Birefnet-lite.safetensors")),
        "Birefnet.safetensors": os.path.exists(os.path.join(bg_dir, "Birefnet.safetensors")),
        "BiRefNet_HR.safetensors": os.path.exists(os.path.join(bg_dir, "BiRefNet_HR.safetensors")),
        "BiRefNet-portrait.safetensors": os.path.exists(os.path.join(bg_dir, "BiRefNet-portrait.safetensors")),
        "birefnet_finetuned_toonout.pth": os.path.exists(os.path.join(bg_dir, "birefnet_finetuned_toonout.pth"))
    }
    
    with _ACTIVE_DOWNLOADS_LOCK:
        active = list(_ACTIVE_DOWNLOADS.keys())
        
    return web.json_response({
        "sam": sam_models,
        "background_removal": bg_models,
        "active_downloads": active
    })
 
def pre_install_cv2_bg():
    def worker():
        try:
            import cv2
        except (ImportError, ModuleNotFoundError):
            print("TrixLoader: Pre-emptively installing OpenCV ('opencv-python') in the background...")
            auto_pip_install("opencv-python")
    
    t = threading.Thread(target=worker, daemon=True)
    t.start()

@PromptServer.instance.routes.post('/trix/download_model')
async def api_download_model(request):
    try:
        pre_install_cv2_bg()
        data = await request.json()
        model_name = data.get("model_name")
        
        if model_name not in MODEL_URLS:
            return web.json_response({"error": f"Unknown model: {model_name}"}, status=400)
            
        folder_name = MODEL_FOLDERS[model_name]
        dest_dir = os.path.join(folder_paths.models_dir, folder_name)
        os.makedirs(dest_dir, exist_ok=True)
        # GroundingDINO saves as model.safetensors (matches HF repo structure)
        if model_name == "groundingdino_swint_ogc.safetensors":
            dest_path = os.path.join(dest_dir, "model.safetensors")
        else:
            dest_path = os.path.join(dest_dir, model_name)
        
        # Check if already exists
        if os.path.exists(dest_path):
            if model_name == "groundingdino_swint_ogc.safetensors":
                if os.path.exists(os.path.join(dest_dir, "config.json")):
                    return web.json_response({"status": "already_exists"})
            else:
                return web.json_response({"status": "already_exists"})
            
        with _ACTIVE_DOWNLOADS_LOCK:
            if model_name in _ACTIVE_DOWNLOADS:
                return web.json_response({"status": "downloading"})
            
            thread = threading.Thread(
                target=download_model_thread,
                args=(MODEL_URLS[model_name], dest_path, model_name, dest_dir)
            )
            _ACTIVE_DOWNLOADS[model_name] = thread
            thread.start()
            
        return web.json_response({"status": "started"})
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"error": str(e)}, status=500)

_PIP_INSTALL_LOCK = threading.Lock()

def auto_pip_install(package_name):
    import sys
    import subprocess
    
    with _PIP_INSTALL_LOCK:
        # Double-check if already installed
        try:
            if package_name == "opencv-python":
                import cv2
            elif package_name == "transparent-background":
                import transparent_background
            else:
                import importlib
                importlib.import_module(package_name.replace("-", "_"))
            print(f"TrixLoader: '{package_name}' is already installed (verified via import). skipping pip.")
            return True
        except (ImportError, ModuleNotFoundError):
            pass

        print(f"TrixLoader: Missing Python package '{package_name}'. Auto-installing via pip...")
        try:
            python_exe = sys.executable
            subprocess.check_call([python_exe, "-m", "pip", "install", package_name])
            print(f"TrixLoader: Successfully installed '{package_name}'!")
            return True
        except Exception as e:
            print(f"TrixLoader: Standard installation of '{package_name}' failed: {e}")
            print("TrixLoader: Attempting fallback installation (installing dependencies without overriding OpenCV)...")
            try:
                python_exe = sys.executable
                # Install known safe dependencies that do not conflict with running cv2
                deps = ["albucore==0.0.24", "pymatting", "timm", "kornia", "gdown", "wget", "easydict", "scipy", "pydantic"]
                for dep in deps:
                    try:
                        if dep.startswith("albucore"):
                            subprocess.check_call([python_exe, "-m", "pip", "install", "--no-deps", dep])
                        else:
                            subprocess.check_call([python_exe, "-m", "pip", "install", dep])
                    except Exception as dep_err:
                        print(f"TrixLoader: Warning: Failed to install dependency '{dep}': {dep_err}")
                
                # Install package with --no-deps to avoid cv2 conflicts
                subprocess.check_call([python_exe, "-m", "pip", "install", "--no-deps", package_name])
                print(f"TrixLoader: Successfully installed '{package_name}' using fallback strategy!")
                return True
            except Exception as fallback_err:
                print(f"TrixLoader: Fallback installation failed: {fallback_err}")
                return False

def import_cv2():
    try:
        import cv2
        return cv2
    except (ImportError, ModuleNotFoundError):
        print("TrixLoader: OpenCV ('opencv-python') is missing. Attempting auto-install...")
        installed = auto_pip_install("opencv-python")
        if installed:
            import importlib
            importlib.invalidate_caches()
            try:
                import cv2
                return cv2
            except Exception:
                pass
        raise ImportError(
            "TrixLoader requires 'opencv-python' for PRO mode post-processing and edge refinement. "
            "Auto-installation failed. Please run 'pip install opencv-python' manually in your python environment."
        )

def auto_install_custom_node(zip_url, folder_name, parent_path=None):
    import urllib.request
    import zipfile
    import shutil
    import tempfile
    import ssl
    
    if parent_path is None:
        parent_path = os.path.abspath(os.path.join(folder_paths.models_dir, "..", "custom_nodes"))
    dest_path = os.path.join(parent_path, folder_name)
    
    if os.path.exists(dest_path):
        return
        
    print(f"TrixLoader: Custom node dependency '{folder_name}' not found. Auto-installing from {zip_url} into {parent_path}...")
    try:
        context = ssl._create_unverified_context()
        req = urllib.request.Request(zip_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, context=context, timeout=60) as response:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp_file:
                shutil.copyfileobj(response, tmp_file)
                tmp_zip = tmp_file.name
                
        with zipfile.ZipFile(tmp_zip, 'r') as zip_ref:
            top_dir = zip_ref.namelist()[0].split('/')[0]
            zip_ref.extractall(parent_path)
            
        extracted_path = os.path.join(parent_path, top_dir)
        if os.path.exists(dest_path):
            shutil.rmtree(dest_path)
        os.rename(extracted_path, dest_path)
        print(f"TrixLoader: Successfully installed custom node '{folder_name}'!")
        
        try:
            os.remove(tmp_zip)
        except:
            pass
    except Exception as e:
        print(f"TrixLoader: Failed to install custom node '{folder_name}': {e}")
        raise RuntimeError(f"Failed to auto-install custom node dependency '{folder_name}'. (Error: {e})") from e

def import_sam2_libs():
    import sys
    import importlib
    current_dir = os.path.dirname(os.path.abspath(__file__))
    sam2_path = os.path.join(current_dir, "ComfyUI-segment-anything-2")
    
    if not os.path.exists(sam2_path):
        custom_nodes_path = os.path.abspath(os.path.join(folder_paths.models_dir, "..", "custom_nodes"))
        sam2_path = os.path.join(custom_nodes_path, "ComfyUI-segment-anything-2")
        if not os.path.exists(sam2_path):
            try:
                auto_install_custom_node(
                    "https://github.com/Kijai/ComfyUI-segment-anything-2/archive/refs/heads/main.zip",
                    "ComfyUI-segment-anything-2",
                    parent_path=current_dir
                )
                sam2_path = os.path.join(current_dir, "ComfyUI-segment-anything-2")
            except Exception as e:
                try:
                    auto_install_custom_node(
                        "https://github.com/Kijai/ComfyUI-segment-anything-2/archive/refs/heads/main.zip",
                        "ComfyUI-segment-anything-2",
                        parent_path=custom_nodes_path
                    )
                    sam2_path = os.path.join(custom_nodes_path, "ComfyUI-segment-anything-2")
                except Exception as e2:
                    raise ImportError(
                        "SAM 2.1 is missing dependencies. The custom node 'ComfyUI-segment-anything-2' is not installed, "
                        f"and auto-installation failed: {e2}. Please install it manually via ComfyUI Manager."
                    ) from e2

    parent_dir = os.path.dirname(sam2_path)
    if parent_dir not in sys.path:
        sys.path.insert(0, parent_dir)
    try:
        mod = importlib.import_module("ComfyUI-segment-anything-2.load_model")
        return mod.load_model
    except (ImportError, ModuleNotFoundError) as e:
        raise ImportError(
            "SAM 2.1 is missing dependencies. Failed to load 'ComfyUI-segment-anything-2'. "
            "Please reinstall 'ComfyUI-segment-anything-2' and restart ComfyUI."
        ) from e

def get_sam2_predictor(model_name, device):
    global _LOADED_MODELS
    model_key = f"sam2.1_{model_name}"
    
    with _LOADED_MODELS_LOCK:
        if model_key in _LOADED_MODELS:
            predictor = _LOADED_MODELS[model_key]
            predictor.model.to(device)
            return predictor

    offload_other_models(model_key)
    
    load_model_fn = import_sam2_libs()
    
    current_dir = os.path.dirname(os.path.abspath(__file__))
    sam2_node_path = os.path.abspath(os.path.join(current_dir, "ComfyUI-segment-anything-2"))
    if not os.path.exists(sam2_node_path):
        custom_nodes_path = os.path.abspath(os.path.join(folder_paths.models_dir, "..", "custom_nodes"))
        sam2_node_path = os.path.abspath(os.path.join(custom_nodes_path, "ComfyUI-segment-anything-2"))
    
    sam_dir = os.path.join(folder_paths.models_dir, "sams")
    model_path = os.path.join(sam_dir, model_name)
    
    cfg_filename = "sam2.1_hiera_t.yaml" if "tiny" in model_name else "sam2.1_hiera_l.yaml"
    model_cfg_path = os.path.join(sam2_node_path, "sam2_configs", cfg_filename)
    
    print(f"TrixLoader: Loading SAM2.1 model {model_name} from {model_path} on {device}...")
    dtype = torch.float16 if device == "cuda" else torch.float32
    predictor = load_model_fn(
        model_path=model_path,
        model_cfg_path=model_cfg_path,
        segmentor="single_image",
        dtype=dtype,
        device=device
    )
    
    with _LOADED_MODELS_LOCK:
        _LOADED_MODELS[model_key] = predictor
    return predictor

def import_sam3_libs():
    import sys
    import importlib
    current_dir = os.path.dirname(os.path.abspath(__file__))
    sam3_path = os.path.join(current_dir, "comfyui-easy-sam3")
    
    if not os.path.exists(sam3_path):
        custom_nodes_path = os.path.abspath(os.path.join(folder_paths.models_dir, "..", "custom_nodes"))
        sam3_path = os.path.join(custom_nodes_path, "comfyui-easy-sam3")
        if not os.path.exists(sam3_path):
            try:
                auto_install_custom_node(
                    "https://github.com/yolain/comfyui-easy-sam3/archive/refs/heads/main.zip",
                    "comfyui-easy-sam3",
                    parent_path=current_dir
                )
                sam3_path = os.path.join(current_dir, "comfyui-easy-sam3")
            except Exception as e:
                try:
                    auto_install_custom_node(
                        "https://github.com/yolain/comfyui-easy-sam3/archive/refs/heads/main.zip",
                        "comfyui-easy-sam3",
                        parent_path=custom_nodes_path
                    )
                    sam3_path = os.path.join(custom_nodes_path, "comfyui-easy-sam3")
                except Exception as e2:
                    raise ImportError(
                        "SAM 3 is missing dependencies. The custom node 'comfyui-easy-sam3' is not installed, "
                        f"and auto-installation failed: {e2}. Please install it manually via ComfyUI Manager."
                    ) from e2

    sam3_deps = {
        "torchvision": "torchvision",
        "timm": "timm",
        "ftfy": "ftfy",
        "regex": "regex",
        "iopath": "iopath",
        "einops": "einops",
        "decord": "decord",
        "pycocotools": "pycocotools",
        "scipy": "scipy",
        "scikit-image": "skimage",
        "scikit-learn": "sklearn",
        "pandas": "pandas",
        "open-clip-torch": "open_clip"
    }
    for pip_name, import_name in sam3_deps.items():
        try:
            __import__(import_name)
        except (ImportError, ModuleNotFoundError):
            auto_pip_install(pip_name)

    easy_sam3_path = os.path.abspath(sam3_path)
    
    if easy_sam3_path not in sys.path:
        sys.path.insert(0, easy_sam3_path)
        
    if 'sam3' in sys.modules:
        mod = sys.modules['sam3']
        if hasattr(mod, '__file__') and mod.__file__ and not mod.__file__.startswith(easy_sam3_path):
            print(f"TrixLoader: Removing conflicting 'sam3' from sys.modules ({mod.__file__})")
            for key in list(sys.modules.keys()):
                if key == 'sam3' or key.startswith('sam3.'):
                    del sys.modules[key]

    # Auto-download CLIP vocabulary if missing
    sam3_assets_dir = os.path.join(easy_sam3_path, "sam3", "assets")
    bpe_path = os.path.join(sam3_assets_dir, "bpe_simple_vocab_16e6.txt.gz")
    if not os.path.exists(bpe_path):
        print(f"TrixLoader: BPE vocabulary missing. Downloading to {bpe_path}...")
        try:
            os.makedirs(sam3_assets_dir, exist_ok=True)
            import urllib.request
            import ssl
            url = "https://github.com/openai/CLIP/raw/main/clip/bpe_simple_vocab_16e6.txt.gz"
            ssl_context = ssl._create_unverified_context()
            with urllib.request.urlopen(url, context=ssl_context) as response, open(bpe_path, "wb") as out_file:
                out_file.write(response.read())
            print("TrixLoader: BPE vocabulary downloaded successfully.")
        except Exception as e:
            print(f"TrixLoader: Error downloading BPE vocabulary: {e}")

    # Mock Triton if missing to prevent compile/import errors
    try:
        import triton
    except ImportError:
        import types
        import importlib.machinery
        spec = importlib.machinery.ModuleSpec("triton", None)
        triton_mock = types.ModuleType("triton")
        triton_mock.__spec__ = spec
        triton_mock.language = types.ModuleType("triton.language")
        triton_mock.language.__spec__ = importlib.machinery.ModuleSpec("triton.language", None)
        triton_mock.language.constexpr = None
        triton_mock.jit = lambda *args, **kwargs: (lambda f: f)
        triton_mock.autotune = lambda *args, **kwargs: (lambda f: f)
        triton_mock.Config = lambda *args, **kwargs: None
        triton_mock.is_mock = True
        sys.modules["triton"] = triton_mock
        sys.modules["triton.language"] = triton_mock.language
        print("TrixLoader: Triton was not found. Injected dummy triton mocks with ModuleSpec to allow compilation.")

    # Monkey-patch sdpa_kernel to ensure other backends are appended for Flash Attention fallbacks
    try:
        import torch
        from torch.nn.attention import SDPBackend, sdpa_kernel
        original_sdpa_kernel = torch.nn.attention.sdpa_kernel
        
        def patched_sdpa_kernel(backends):
            new_backends = [SDPBackend.MATH, SDPBackend.EFFICIENT_ATTENTION]
            if isinstance(backends, (list, tuple, set)):
                for b in backends:
                    if b not in new_backends:
                        new_backends.append(b)
            else:
                if backends not in new_backends:
                    new_backends.append(backends)
            return original_sdpa_kernel(new_backends)
            
        torch.nn.attention.sdpa_kernel = patched_sdpa_kernel
        print("TrixLoader: Monkey-patched sdpa_kernel for robust attention fallbacks.")
    except Exception as e:
        print(f"TrixLoader: Failed to patch sdpa_kernel: {e}")
                    
    try:
        from sam3.model_builder import build_sam3_image_model
        from sam3.model.sam3_image_processor import Sam3Processor
        return build_sam3_image_model, Sam3Processor
    except (ImportError, ModuleNotFoundError) as err:
        raise ImportError(
            "SAM 3 is missing dependencies. Failed to load 'comfyui-easy-sam3'. "
            "Please reinstall 'comfyui-easy-sam3' and restart ComfyUI."
        ) from err

def move_tensor_to_device(val, device):
    if isinstance(val, torch.Tensor):
        try:
            if val.dtype in (torch.float16, torch.float32, torch.float64):
                if device == "cpu":
                    if val.dtype == torch.float16:
                        val = val.float()
                else:
                    if val.dtype == torch.float32:
                        val = val.half()
            return val.to(device)
        except Exception:
            try:
                return val.to(device)
            except Exception:
                return val
    elif isinstance(val, list):
        return [move_tensor_to_device(item, device) for item in val]
    elif isinstance(val, tuple):
        return tuple(move_tensor_to_device(item, device) for item in val)
    elif isinstance(val, dict):
        return {k: move_tensor_to_device(v, device) for k, v in val.items()}
    elif hasattr(val, "__dict__") and not isinstance(val, torch.nn.Module):
        for k, v in list(val.__dict__.items()):
            val.__dict__[k] = move_tensor_to_device(v, device)
        return val
    return val

def move_custom_tensors(module, device):
    for name, val in list(module.__dict__.items()):
        module.__dict__[name] = move_tensor_to_device(val, device)
    for child in module.children():
        move_custom_tensors(child, device)

def move_processor_tensors(processor, device):
    # 1. Move model parameters and buffers
    processor.model.to(device)
    if device == "cpu":
        processor.model.float()
    else:
        processor.model.half()
        
    # 2. Move custom model tensors (e.g. RoPE freqs, coord_cache, compilable_cord_cache)
    move_custom_tensors(processor.model, device)
    
    # 3. Update device string
    processor.device = device
    
    # 4. Move find_stage and other helper tensors
    if hasattr(processor, "__dict__"):
        for name, val in list(processor.__dict__.items()):
            if not isinstance(val, torch.nn.Module):
                processor.__dict__[name] = move_tensor_to_device(val, device)

def get_sam3_predictor(device):
    global _LOADED_MODELS
    model_key = "sam3-fp16.safetensors"
    
    with _LOADED_MODELS_LOCK:
        if model_key in _LOADED_MODELS:
            processor = _LOADED_MODELS[model_key]
            move_processor_tensors(processor, device)
            return processor

    offload_other_models(model_key)
    
    build_sam3_image_model, Sam3Processor = import_sam3_libs()
    
    sam_dir = os.path.join(folder_paths.models_dir, "sams")
    checkpoint_path = os.path.join(sam_dir, "sam3-fp16.safetensors")
    
    print(f"TrixLoader: Loading SAM3 model from {checkpoint_path} on {device}...")
    model = build_sam3_image_model(
        device=device,
        eval_mode=True,
        checkpoint_path=checkpoint_path,
        load_from_HF=False,
        enable_segmentation=True,
        enable_inst_interactivity=False,
        compile=False
    )
    
    processor = Sam3Processor(
        model=model,
        resolution=1008,
        confidence_threshold=0.3,
        device=device
    )
    
    move_processor_tensors(processor, device)
    
    with _LOADED_MODELS_LOCK:
        _LOADED_MODELS[model_key] = processor
    return processor

def get_groundingdino_model(device):
    global _LOADED_MODELS
    model_key = "groundingdino_swint_ogc.safetensors"
    
    with _LOADED_MODELS_LOCK:
        if model_key in _LOADED_MODELS:
            processor, model = _LOADED_MODELS[model_key]
            model.to(device)
            return processor, model

    offload_other_models(model_key)
    
    try:
        from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
        from huggingface_hub import snapshot_download
    except (ImportError, ModuleNotFoundError):
        print("TrixLoader: transformers or huggingface_hub is missing. Attempting auto-install...")
        installed_tr = auto_pip_install("transformers")
        installed_hf = auto_pip_install("huggingface_hub")
        if installed_tr and installed_hf:
            import importlib
            importlib.invalidate_caches()
            from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
            from huggingface_hub import snapshot_download
        else:
            raise ImportError(
                "GroundingDINO requires the 'transformers' and 'huggingface_hub' packages. "
                "Auto-installation failed. Please run 'pip install transformers huggingface_hub' manually."
            )
    
    dino_dir = os.path.join(folder_paths.models_dir, "grounding-dino")
    
    # Auto-download from Hugging Face if files are missing locally (need model and config files)
    if not os.path.exists(dino_dir) or not os.path.exists(os.path.join(dino_dir, "model.safetensors")) or not os.path.exists(os.path.join(dino_dir, "config.json")):
        print(f"TrixLoader: GroundingDINO model or config files not found locally in {dino_dir}. Downloading automatically...")
        try:
            snapshot_download_with_progress(
                repo_id="IDEA-Research/grounding-dino-tiny",
                local_dir=dino_dir,
                model_name=model_key,
                use_mirror=locale_is_ru()
            )
        except Exception as conn_err:
            raise RuntimeError(
                f"Failed to auto-download GroundingDINO config files from Hugging Face. "
                f"Please ensure you have an active internet connection. (Error: {conn_err})"
            ) from conn_err
        
    print(f"TrixLoader: Loading GroundingDINO SwinT OGC model from local folder {dino_dir} on {device}...")
    try:
        processor = AutoProcessor.from_pretrained(dino_dir)
        model = AutoModelForZeroShotObjectDetection.from_pretrained(dino_dir)
    except Exception as load_err:
        raise RuntimeError(
            f"Failed to initialize GroundingDINO model from {dino_dir}. (Error: {load_err})"
        ) from load_err
    
    model.to(device)
    model.eval()
    
    with _LOADED_MODELS_LOCK:
        _LOADED_MODELS[model_key] = (processor, model)
    return processor, model

@PromptServer.instance.routes.post('/trix/load_model')
async def api_load_model(request):
    try:
        data = await request.json()
        model_name = data.get("model")
        image_filename = data.get("image")
        
        if not model_name:
            return web.json_response({"status": "error", "error": "Missing model parameter"}, status=400)
            
        device_selection = data.get("device", "AUTO")
        if device_selection == "GPU":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        elif device_selection == "CPU":
            device = "cpu"
        else:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        
        def do_load():
            global _CURRENT_SAM3_STATE, _CURRENT_SAM3_IMAGE, _CURRENT_SAM3_DEVICE
            if "sam2.1" in model_name:
                get_sam2_predictor(model_name, device)
            elif "sam3" in model_name:
                if _CURRENT_SAM3_DEVICE != device:
                    _CURRENT_SAM3_STATE = None
                    _CURRENT_SAM3_IMAGE = None
                    _CURRENT_SAM3_DEVICE = device
                processor = get_sam3_predictor(device)
                if image_filename:
                    image_path = folder_paths.get_annotated_filepath(image_filename)
                    if os.path.exists(image_path):
                        img = Image.open(image_path).convert("RGB")
                        print("TrixLoader: Pre-computing SAM3 features during model load...")
                        dtype = torch.float16 if device == "cuda" else torch.float32
                        autocast_ctx = torch.autocast("cuda", dtype=dtype) if device == "cuda" else nullcontext()
                        with autocast_ctx:
                            _CURRENT_SAM3_STATE = processor.set_image(img)
                        _CURRENT_SAM3_IMAGE = image_path
                        
        await asyncio.to_thread(do_load)
        return web.json_response({"status": "success"})
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"status": "error", "error": str(e)}, status=500)

def postprocess_mask_pro(mask_np, input_points=None):
    try:
        cv2 = import_cv2()
        if mask_np is None or mask_np.size == 0:
            return mask_np
            
        print("TrixLoader: Running SAM PRO Mode post-processing...")
        
        # 1. Median blur to eliminate checkerboard and salt-and-pepper noise
        mask_np = cv2.medianBlur(mask_np, 5)
        
        # 2. Morphological closing to fill small holes and gaps
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask_np = cv2.morphologyEx(mask_np, cv2.MORPH_CLOSE, kernel)
        
        # 3. Connected components analysis
        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask_np, connectivity=8)
        
        keep_labels = set()
        if input_points and len(input_points) > 0:
            for pt in input_points:
                px, py = int(pt[0]), int(pt[1])
                # Check a 5x5 window around the click
                found = False
                for dy in range(-2, 3):
                    for dx in range(-2, 3):
                        cx = max(0, min(px + dx, mask_np.shape[1] - 1))
                        cy = max(0, min(py + dy, mask_np.shape[0] - 1))
                        lbl = labels[cy, cx]
                        if lbl > 0:
                            keep_labels.add(lbl)
                            found = True
                            break
                    if found:
                        break
                        
        cleaned_count = 0
        kept_count = 0
        if len(keep_labels) > 0:
            mask_pro = np.zeros_like(mask_np)
            for lbl in keep_labels:
                mask_pro[labels == lbl] = 255
            kept_count = len(keep_labels)
            cleaned_count = (num_labels - 1) - kept_count
            mask_np = mask_pro
        else:
            # For text prompts or when no label was hit by points, keep labels based on minimum area threshold
            min_area = int(mask_np.shape[0] * mask_np.shape[1] * 0.001)
            min_area = max(100, min_area)
            mask_pro = np.zeros_like(mask_np)
            for lbl in range(1, num_labels):
                if stats[lbl, cv2.CC_STAT_AREA] >= min_area:
                    mask_pro[labels == lbl] = 255
                    kept_count += 1
            cleaned_count = (num_labels - 1) - kept_count
            mask_np = mask_pro
            
        # 4. A final morphological opening to smooth edges
        mask_np = cv2.morphologyEx(mask_np, cv2.MORPH_OPEN, kernel)
        
        print(f"TrixLoader: PRO Mode complete. Detected {num_labels - 1} components, kept {kept_count}, discarded {cleaned_count} background noise islands.")
        return mask_np
    except Exception as e:
        print(f"TrixLoader: PRO mode post-processing failed: {e}")
        return mask_np

@PromptServer.instance.routes.post('/trix/sam_predict')
async def api_sam_predict(request):
    try:
        data = await request.json()
        image_filename = data.get("image")
        model_name = data.get("model")
        
        points_data = data.get("points", None)
        if points_data is not None:
            input_points = []
            for pt in points_data:
                if pt is not None and len(pt) >= 2 and pt[0] is not None and pt[1] is not None:
                    input_points.append([float(pt[0]), float(pt[1])])
        else:
            x_val = data.get("x")
            y_val = data.get("y")
            x = float(x_val) if x_val is not None else 0.0
            y = float(y_val) if y_val is not None else 0.0
            input_points = [[x, y]]
            
        threshold_val = data.get("threshold")
        threshold = float(threshold_val) if threshold_val is not None else 0.0
        
        text_prompt = data.get("text_prompt", "").strip()
        
        is_hover = data.get("is_hover", False)
        if "sam3" in model_name:
            model_key = "sam3-fp16.safetensors"
        else:
            model_key = f"sam2.1_{model_name}"
        is_loaded = False
        with _LOADED_MODELS_LOCK:
            is_loaded = model_key in _LOADED_MODELS
            
        if is_hover and not is_loaded:
            return web.json_response({"status": "not_loaded"})
            
        image_path = folder_paths.get_annotated_filepath(image_filename)
        img = Image.open(image_path).convert("RGB")
        
        device_selection = data.get("device", "AUTO")
        if device_selection == "GPU":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        elif device_selection == "CPU":
            device = "cpu"
        else:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        
        def run_inference():
            # 1. SAM 2.1 TEXT PROMPT via GroundingDINO
            if "sam2.1" in model_name and text_prompt:
                dino_device = device
                processor, dino_model = get_groundingdino_model(dino_device)
                
                prompt_str = text_prompt.lower()
                if not prompt_str.endswith("."):
                    prompt_str += "."
                    
                inputs = processor(images=img, text=prompt_str, return_tensors="pt").to(dino_device)
                with torch.no_grad():
                    outputs = dino_model(**inputs)
                    
                import inspect
                post_process_args = {
                    "outputs": outputs,
                    "input_ids": inputs.input_ids,
                    "text_threshold": 0.25,
                    "target_sizes": [img.size[::-1]]
                }
                sig = inspect.signature(processor.post_process_grounded_object_detection)
                if "box_threshold" in sig.parameters:
                    post_process_args["box_threshold"] = threshold
                else:
                    post_process_args["threshold"] = threshold
                    
                results = processor.post_process_grounded_object_detection(**post_process_args)
                
                boxes = results[0]["boxes"]
                
                predictor = get_sam2_predictor(model_name, device)
                
                # Autocast context for float16 models on CUDA
                dtype = torch.float16 if device == "cuda" else torch.float32
                autocast_ctx = torch.autocast("cuda", dtype=dtype) if device == "cuda" else nullcontext()
                
                with autocast_ctx:
                    predictor.set_image(img)
                
                h, w = img.height, img.width
                combined_mask = np.zeros((h, w), dtype=bool)
                
                if len(boxes) > 0:
                    print(f"TrixLoader: GroundingDINO detected {len(boxes)} boxes for '{text_prompt}'")
                    eps = 1e-8
                    logit_threshold = np.log(threshold / (1.0 - threshold + eps))
                    for box in boxes:
                        box_np = box.cpu().numpy()
                        with autocast_ctx:
                            masks, _, _ = predictor.predict(
                                box=box_np,
                                multimask_output=False,
                                return_logits=True
                            )
                        best_logits = masks[0]
                        if hasattr(best_logits, "cpu"):
                            best_logits = best_logits.cpu().numpy()
                        combined_mask = np.maximum(combined_mask, best_logits > logit_threshold)
                else:
                    print(f"TrixLoader: GroundingDINO did not detect any objects for '{text_prompt}'")
                    
                mask_np = (combined_mask * 255).astype(np.uint8)
                return mask_np

            # 2. SAM 3 (TEXT & CLICK PROMPT)
            elif "sam3" in model_name:
                global _CURRENT_SAM3_STATE, _CURRENT_SAM3_IMAGE, _CURRENT_SAM3_DEVICE
                
                if _CURRENT_SAM3_DEVICE != device:
                    _CURRENT_SAM3_STATE = None
                    _CURRENT_SAM3_IMAGE = None
                    _CURRENT_SAM3_DEVICE = device
                
                # Clean up cached GPU memory fragments
                try:
                    import comfy.model_management
                    comfy.model_management.soft_empty_cache()
                    import gc
                    gc.collect()
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                except Exception as e:
                    print(f"TrixLoader: Failed to clear cache: {e}")
                    
                processor = get_sam3_predictor(device)
                processor.set_confidence_threshold(min(0.25, threshold))
                
                # Autocast context for float16 models on CUDA
                dtype = torch.float16 if device == "cuda" else torch.float32
                autocast_ctx = torch.autocast("cuda", dtype=dtype) if device == "cuda" else nullcontext()
                
                if text_prompt:
                    text_prompts = [p.strip() for p in text_prompt.split(',') if p.strip()]
                    h, w = img.height, img.width
                    combined_mask = np.zeros((h, w), dtype=bool)
                    
                    # Compute image embedding ONCE
                    with autocast_ctx:
                        base_state = processor.set_image(img)
                    
                    for single_prompt in text_prompts:
                        # Copy the state to avoid polluting features across prompts
                        state = {
                            'original_height': base_state['original_height'],
                            'original_width': base_state['original_width'],
                            'backbone_out': dict(base_state['backbone_out'])
                        }
                        with autocast_ctx:
                            state = processor.set_text_prompt(single_prompt, state)
                        
                        masks_logits = state.get('masks_logits', None)
                        if masks_logits is not None and len(masks_logits) > 0:
                            for m_tensor in masks_logits:
                                m_np = m_tensor[0].cpu().numpy() > threshold
                                combined_mask = np.maximum(combined_mask, m_np)
                        else:
                            masks = state.get('masks', None)
                            if masks is not None and len(masks) > 0:
                                for m_tensor in masks:
                                    m_np = m_tensor[0].cpu().numpy() > 0.5
                                    combined_mask = np.maximum(combined_mask, m_np)
                                
                    mask_np = (combined_mask * 255).astype(np.uint8)
                    return mask_np
                else:
                    if _CURRENT_SAM3_IMAGE != image_path or _CURRENT_SAM3_STATE is None:
                        print("TrixLoader: Computing image embedding for SAM3...")
                        with autocast_ctx:
                            _CURRENT_SAM3_STATE = processor.set_image(img)
                        _CURRENT_SAM3_IMAGE = image_path
                        
                    # Extract fresh, unpolluted copy of cached state features
                    state = {
                        'original_height': _CURRENT_SAM3_STATE['original_height'],
                        'original_width': _CURRENT_SAM3_STATE['original_width'],
                        'backbone_out': _CURRENT_SAM3_STATE['backbone_out']
                    }
                    
                    if len(input_points) > 0:
                        # Normalize point coordinates to [0, 1] range for SAM 3
                        w_img, h_img = img.size
                        point_coords = [[float(pt[0]) / w_img, float(pt[1]) / h_img] for pt in input_points]
                        point_labels = [1] * len(input_points)
                        with autocast_ctx:
                            state = processor.add_point_prompt(point_coords, point_labels, state)
                        
                        masks_logits = state.get('masks_logits', None)
                        scores = state.get('scores', None)
                        h, w = img.height, img.width
                        combined_mask = np.zeros((h, w), dtype=bool)
                        
                        if masks_logits is not None and len(masks_logits) > 0:
                            best_idx = torch.argmax(scores).item()
                            best_mask = masks_logits[best_idx, 0].cpu().numpy() > threshold
                            combined_mask = best_mask
                        else:
                            masks = state.get('masks', None)
                            if masks is not None and len(masks) > 0:
                                best_idx = torch.argmax(scores).item()
                                best_mask = masks[best_idx, 0].cpu().numpy() > 0.5
                                combined_mask = best_mask
                    else:
                        combined_mask = np.zeros((img.height, img.width), dtype=bool)
                        
                    mask_np = (combined_mask * 255).astype(np.uint8)
                    return mask_np

            # 3. SAM 2.1 CLICK PROMPT
            else:
                predictor = get_sam2_predictor(model_name, device)
                
                # Autocast context for float16 models on CUDA
                dtype = torch.float16 if device == "cuda" else torch.float32
                autocast_ctx = torch.autocast("cuda", dtype=dtype) if device == "cuda" else nullcontext()
                
                with autocast_ctx:
                    predictor.set_image(img)
                
                h, w = img.height, img.width
                combined_mask = np.zeros((h, w), dtype=bool)
                
                if len(input_points) > 0:
                    point_coords = np.array(input_points, dtype=np.float32)
                    point_labels = np.ones(len(input_points), dtype=np.int32)
                    
                    with autocast_ctx:
                        masks, scores, _ = predictor.predict(
                            point_coords=point_coords,
                            point_labels=point_labels,
                            multimask_output=True,
                            return_logits=True
                        )
                    
                    best_idx = np.argmax(scores)
                    eps = 1e-8
                    logit_threshold = np.log(threshold / (1.0 - threshold + eps))
                    best_logits = masks[best_idx]
                    if hasattr(best_logits, "cpu"):
                        best_logits = best_logits.cpu().numpy()
                    combined_mask = best_logits > logit_threshold
                    
                mask_np = (combined_mask * 255).astype(np.uint8)
                return mask_np

        def run_inference_locked():
            with _SAM_INFERENCE_LOCK:
                return run_inference()

        mask_np = await asyncio.to_thread(run_inference_locked)
        
        pro = data.get("pro", False)
        if pro:
            is_text_only = bool(text_prompt) and (data.get("x") is None) and (points_data is None)
            pts_for_pro = None if is_text_only else input_points
            mask_np = await asyncio.to_thread(postprocess_mask_pro, mask_np, pts_for_pro)
        
        # We keep the active model in GPU VRAM during the session for instant clicks.
        # It will be offloaded manually when the editor is closed.
            
        mask_img = Image.fromarray(mask_np, mode="L")
        
        buffered = BytesIO()
        mask_img.save(buffered, format="PNG", compress_level=1)
        img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
        
        return web.json_response({"status": "success", "mask": img_str})
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"status": "error", "error": str(e)}, status=500)

_INSPYRENET_REMOVER = None

def get_inspyrenet_remover(device):
    global _LOADED_MODELS
    model_key = "inspyrenet-bf16.safetensors"
    
    with _LOADED_MODELS_LOCK:
        if model_key in _LOADED_MODELS:
            remover = _LOADED_MODELS[model_key]
            remover.model.to(device)
            return remover
            
    offload_other_models(model_key)
    
    def patch_albucore_numpy2():
        try:
            import sys
            import numpy as np
            patched_dicts = []
            for mod_name in ["albucore", "albucore.utils"]:
                try:
                    __import__(mod_name)
                    mod = sys.modules[mod_name]
                    for dct_name in ["MAX_VALUES_BY_DTYPE", "NPDTYPE_TO_OPENCV_DTYPE"]:
                        if hasattr(mod, dct_name):
                            dct = getattr(mod, dct_name)
                            if isinstance(dct, dict) and id(dct) not in patched_dicts:
                                patched_dicts.append(id(dct))
                                # Select appropriate dtype mappings to force into the dictionary
                                if dct_name == "MAX_VALUES_BY_DTYPE":
                                    mappings = {
                                        "uint8": 255,
                                        "uint16": 65535,
                                        "uint32": 4294967295,
                                        "float16": 1.0,
                                        "float32": 1.0,
                                        "float64": 1.0,
                                        "int32": 2147483647,
                                    }
                                elif dct_name == "NPDTYPE_TO_OPENCV_DTYPE":
                                    mappings = {
                                        "uint8": 0,
                                        "int8": 1,
                                        "uint16": 2,
                                        "int16": 3,
                                        "int32": 4,
                                        "float32": 5,
                                        "float64": 6,
                                    }
                                else:
                                    mappings = {}
                                
                                for t_name, val in mappings.items():
                                    try:
                                        t_class = getattr(np, t_name)
                                        dt = np.dtype(t_class)
                                        dct[t_class] = val
                                        dct[dt] = val
                                    except Exception:
                                        pass
                except Exception as e:
                    print(f"TrixLoader: albucore pre-patch failed for {mod_name}: {e}")
            print(f"TrixLoader: successfully patched {len(patched_dicts)} dictionary objects for NumPy 2.x compatibility.")
        except Exception as e:
            print(f"TrixLoader: patch_albucore_numpy2 error: {e}")

    patch_albucore_numpy2()
    try:
        import transparent_background
        from transparent_background.utils import load_config
        import shutil
        from transparent_background.InSPyReNet import InSPyReNet_SwinB
        from safetensors.torch import load_file
        from transparent_background.utils import static_resize, tonumpy, normalize, totensor
        import albumentations as A
        import albumentations.pytorch as AP
        import torchvision.transforms as transforms
    except (ImportError, ModuleNotFoundError, KeyError):
        print("TrixLoader: transparent-background or albumentations is missing or incompatible. Attempting auto-install...")
        installed_tb = auto_pip_install("transparent-background")
        installed_al = auto_pip_install("albumentations")
        if installed_tb and installed_al:
            import importlib
            importlib.invalidate_caches()
            patch_albucore_numpy2()
            import transparent_background
            from transparent_background.utils import load_config
            import shutil
            from transparent_background.InSPyReNet import InSPyReNet_SwinB
            from safetensors.torch import load_file
            from transparent_background.utils import static_resize, tonumpy, normalize, totensor
            import albumentations as A
            import albumentations.pytorch as AP
            import torchvision.transforms as transforms
        else:
            raise ImportError(
                "InSPyReNet background removal requires the 'transparent-background' and 'albumentations' packages. "
                "Auto-installation failed. Please run 'pip install transparent-background albumentations' manually."
            )
    
    class CustomInspyrenetRemover(transparent_background.Remover):
        def __init__(self, mode="base", device=None, ckpt_path=None):
            repopath = os.path.dirname(transparent_background.__file__)
            cfg_path = os.environ.get('TRANSPARENT_BACKGROUND_FILE_PATH', os.path.abspath(os.path.expanduser('~')))
            home_dir = os.path.join(cfg_path, ".transparent-background")
            os.makedirs(home_dir, exist_ok=True)
            if not os.path.isfile(os.path.join(home_dir, "config.yaml")):
                shutil.copy(os.path.join(repopath, "config.yaml"), os.path.join(home_dir, "config.yaml"))
            self.meta = load_config(os.path.join(home_dir, "config.yaml"))[mode]

            self.device = device if device is not None else ("cuda:0" if torch.cuda.is_available() else "cpu")
            
            self.model = InSPyReNet_SwinB(depth=64, pretrained=False, threshold=None, **self.meta)
            print(f"TrixLoader: Loading InSPyReNet weights from {ckpt_path}...")
            state_dict = load_file(ckpt_path)
            self.model.load_state_dict(state_dict, strict=True)
            self.model.eval()
            self.model = self.model.to(self.device)
            
            resize_tf = static_resize(self.meta.base_size)
            resize_fn = A.Resize(*self.meta.base_size)
            self.transform = transforms.Compose([
                resize_tf,
                tonumpy(),
                normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
                totensor(),
            ])
            self.cv2_transform = A.Compose([
                resize_fn,
                A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
                AP.ToTensorV2(),
            ])
            self.background = {'img': None, 'name': None, 'shape': None}
            self.matting_fn = None  # Disabled slow CPU alpha matting to make it run instantly

    bg_dir = os.path.join(folder_paths.models_dir, "RMBG")
    weights_path = os.path.join(bg_dir, "inspyrenet-bf16.safetensors")
    
    remover = CustomInspyrenetRemover(mode="base", device=device, ckpt_path=weights_path)
    with _LOADED_MODELS_LOCK:
        _LOADED_MODELS[model_key] = remover
    return remover

def auto_install_ben2(parent_path):
    import urllib.request
    import zipfile
    import shutil
    import tempfile
    import ssl
    
    dest_path = os.path.join(parent_path, "ben2")
    if os.path.exists(dest_path):
        return
        
    zip_url = "https://github.com/PramaLLC/BEN2/archive/refs/heads/main.zip"
    print(f"TrixLoader: Downloading BEN2 library from {zip_url} into {parent_path}...")
    try:
        context = ssl._create_unverified_context()
        req = urllib.request.Request(zip_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, context=context, timeout=60) as response:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp_file:
                shutil.copyfileobj(response, tmp_file)
                tmp_zip = tmp_file.name
                
        with tempfile.TemporaryDirectory() as tmp_dir:
            with zipfile.ZipFile(tmp_zip, 'r') as zip_ref:
                zip_ref.extractall(tmp_dir)
            
            top_dir = os.listdir(tmp_dir)[0]
            src_ben2 = os.path.join(tmp_dir, top_dir, "src", "ben2")
            if os.path.exists(src_ben2):
                shutil.copytree(src_ben2, dest_path)
                print(f"TrixLoader: Successfully installed BEN2 library at {dest_path}")
            else:
                raise RuntimeError("Could not find 'src/ben2' folder inside extracted ZIP.")
        
        try:
            os.remove(tmp_zip)
        except:
            pass
    except Exception as e:
        print(f"TrixLoader: Failed to install BEN2: {e}")
        raise RuntimeError(f"Failed to auto-install BEN2 library. (Error: {e})") from e

def import_ben2_libs():
    import sys
    import importlib
    current_dir = os.path.dirname(os.path.abspath(__file__))
    ben2_path = os.path.join(current_dir, "ben2")
    
    if not os.path.exists(ben2_path):
        try:
            auto_install_ben2(current_dir)
        except Exception as e:
            raise ImportError(
                "BEN2 is missing dependencies. Failed to auto-install 'ben2' library: "
                f"{e}. Please install it manually."
            ) from e
            
    try:
        from safetensors.torch import load_file
    except (ImportError, ModuleNotFoundError):
        auto_pip_install("safetensors")
        
    if current_dir not in sys.path:
        sys.path.insert(0, current_dir)
        
    try:
        from ben2 import BEN_Base
        from safetensors.torch import load_file
        return BEN_Base, load_file
    except (ImportError, ModuleNotFoundError) as e:
        raise ImportError(
            "BEN2 is missing dependencies. Failed to import 'ben2' from local directory. "
            "Please restart ComfyUI."
        ) from e

def get_ben2_remover(device):
    global _LOADED_MODELS
    model_key = "Ben2.safetensors"
    
    with _LOADED_MODELS_LOCK:
        if model_key in _LOADED_MODELS:
            model = _LOADED_MODELS[model_key]
            model.to(device)
            return model
            
    offload_other_models(model_key)
    
    BEN_Base, load_file = import_ben2_libs()
    
    bg_dir = os.path.join(folder_paths.models_dir, "RMBG")
    weights_path = os.path.join(bg_dir, "Ben2.safetensors")
    
    print(f"TrixLoader: Loading BEN2 model from {weights_path} on {device}...")
    model = BEN_Base()
    
    state_dict = load_file(weights_path)
    # Check key mappings
    model_keys = set(model.state_dict().keys())
    state_keys = set(state_dict.keys())
    if not state_keys.intersection(model_keys):
        new_state_dict = {}
        for k, v in state_dict.items():
            if k.startswith("model."):
                new_state_dict[k[6:]] = v
            else:
                new_state_dict[f"model.{k}"] = v
        state_dict = new_state_dict
        
    model.load_state_dict(state_dict)
    model.to(device)
    model.eval()
    
    with _LOADED_MODELS_LOCK:
        _LOADED_MODELS[model_key] = model
    return model

def get_birefnet_model(model_name, device):
    global _LOADED_MODELS
    model_key = f"birefnet_{model_name}"
    
    with _LOADED_MODELS_LOCK:
        if model_key in _LOADED_MODELS:
            model = _LOADED_MODELS[model_key]
            model.to(device)
            return model
            
    offload_other_models(model_key)
    
    try:
        from transformers import AutoConfig, AutoModelForImageSegmentation
        from safetensors.torch import load_file
        import timm
    except (ImportError, ModuleNotFoundError):
        print("TrixLoader: transformers, safetensors, or timm is missing. Attempting auto-install...")
        installed_tr = auto_pip_install("transformers")
        installed_st = auto_pip_install("safetensors")
        installed_ti = auto_pip_install("timm")
        if installed_tr and installed_st and installed_ti:
            import importlib
            importlib.invalidate_caches()
            from transformers import AutoConfig, AutoModelForImageSegmentation
            from safetensors.torch import load_file
            import timm
        else:
            raise ImportError(
                "BiRefNet requires the 'transformers', 'safetensors', and 'timm' packages. "
                "Auto-installation failed. Please run 'pip install transformers safetensors timm' manually."
            )
    
    bg_dir = os.path.join(folder_paths.models_dir, "RMBG")
    config_dir = os.path.join(bg_dir, "birefnet_config")
    
    print(f"TrixLoader: Instantiating BiRefNet structure for {model_name}...")
    BIREFNET_REPOS = {
        "Birefnet-lite.safetensors": "ZhengPeng7/BiRefNet_lite",
        "Birefnet.safetensors": "ZhengPeng7/BiRefNet",
        "BiRefNet_HR.safetensors": "ZhengPeng7/BiRefNet_HR",
        "BiRefNet-portrait.safetensors": "ZhengPeng7/BiRefNet-portrait",
        "birefnet_finetuned_toonout.pth": "ZhengPeng7/BiRefNet"
    }
    repo_id = BIREFNET_REPOS.get(model_name, "ZhengPeng7/BiRefNet")
    
    try:
        # Only load from local config directory if it contains the remote code module birefnet.py and matches standard BiRefNet
        if os.path.exists(config_dir) and os.path.exists(os.path.join(config_dir, "birefnet.py")) and model_name == "Birefnet.safetensors":
            config = AutoConfig.from_pretrained(config_dir, trust_remote_code=True)
        else:
            config = AutoConfig.from_pretrained(repo_id, trust_remote_code=True)
            
        model = AutoModelForImageSegmentation.from_config(config, trust_remote_code=True)
    except Exception as conn_err:
        raise RuntimeError(
            f"Failed to load/instantiate BiRefNet model structure from Hugging Face ({repo_id}). "
            f"Please ensure you have an active internet connection. (Error: {conn_err})"
        ) from conn_err
    
    weights_path = os.path.join(bg_dir, model_name)
    print(f"TrixLoader: Loading BiRefNet weights from {weights_path}...")
    
    if weights_path.endswith(".safetensors"):
        state_dict = load_file(weights_path)
    else:
        state_dict = torch.load(weights_path, map_location="cpu")
        if isinstance(state_dict, dict):
            if "model" in state_dict:
                state_dict = state_dict["model"]
            elif "state_dict" in state_dict:
                state_dict = state_dict["state_dict"]
                
    # Clean up prefixes from DDP and compiled wrappers
    cleaned_state_dict = {}
    for k, v in state_dict.items():
        new_key = k
        while True:
            if new_key.startswith("module."):
                new_key = new_key[7:]
            elif new_key.startswith("_orig_mod."):
                new_key = new_key[10:]
            else:
                break
        cleaned_state_dict[new_key] = v
    state_dict = cleaned_state_dict
                
    model.load_state_dict(state_dict)
    model.to(device)
    model.eval()
    
    with _LOADED_MODELS_LOCK:
        _LOADED_MODELS[model_key] = model
    return model

@PromptServer.instance.routes.post('/trix/offload')
async def api_offload_models(request):
    try:
        def run_offload():
            global _LOADED_MODELS, _CURRENT_SAM3_STATE, _CURRENT_SAM3_IMAGE, _CURRENT_SAM3_DEVICE
            with _LOADED_MODELS_LOCK:
                print(f"TrixLoader: Exiting editor, clearing all cached models completely ({list(_LOADED_MODELS.keys())})...")
                _LOADED_MODELS.clear()
            _CURRENT_SAM3_STATE = None
            _CURRENT_SAM3_IMAGE = None
            _CURRENT_SAM3_DEVICE = None
            import gc
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        await asyncio.to_thread(run_offload)
        return web.json_response({"status": "success"})
    except Exception as e:
        return web.json_response({"status": "error", "error": str(e)}, status=500)

@PromptServer.instance.routes.post('/trix/unload_model')
async def api_unload_model(request):
    try:
        data = await request.json()
        model_type = data.get("type") # "sam", "bg", or "all"
        
        def run_unload():
            global _LOADED_MODELS, _CURRENT_SAM3_STATE, _CURRENT_SAM3_IMAGE, _CURRENT_SAM3_DEVICE
            with _LOADED_MODELS_LOCK:
                if model_type == "all":
                    print("TrixLoader: Unloading all models completely...")
                    _LOADED_MODELS.clear()
                    _CURRENT_SAM3_STATE = None
                    _CURRENT_SAM3_IMAGE = None
                    _CURRENT_SAM3_DEVICE = None
                elif model_type == "sam":
                    print("TrixLoader: Unloading SAM models...")
                    for key in list(_LOADED_MODELS.keys()):
                        if "sam" in key or "groundingdino" in key:
                            del _LOADED_MODELS[key]
                    _CURRENT_SAM3_STATE = None
                    _CURRENT_SAM3_IMAGE = None
                    _CURRENT_SAM3_DEVICE = None
                elif model_type == "bg":
                    print("TrixLoader: Unloading background removal models...")
                    for key in list(_LOADED_MODELS.keys()):
                        if "sam" not in key and "groundingdino" not in key:
                            del _LOADED_MODELS[key]
            import gc
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        await asyncio.to_thread(run_unload)
        return web.json_response({"status": "success"})
    except Exception as e:
        return web.json_response({"status": "error", "error": str(e)}, status=500)

@PromptServer.instance.routes.post('/trix/remove_background')
async def api_remove_background(request):
    try:
        data = await request.json()
        image_filename = data.get("image")
        model_name = data.get("model")
        alpha_matting = data.get("alpha_matting", False)
        
        image_path = folder_paths.get_annotated_filepath(image_filename)
        img = Image.open(image_path).convert("RGB")
        
        device = "cuda" if torch.cuda.is_available() else "cpu"
        
        def run_inference():
            if model_name == "inspyrenet-bf16.safetensors":
                remover = get_inspyrenet_remover(device)
                print("TrixLoader: Running InSPyReNet background removal...")
                rgba_img = remover.process(img, type="rgba")
                alpha = rgba_img.split()[3]
                mask_img = ImageOps.invert(alpha)
                
            elif model_name == "Ben2.safetensors":
                model = get_ben2_remover(device)
                print("TrixLoader: Running BEN2 background removal...")
                rgba_img = model.inference(img, refine_foreground=alpha_matting)
                alpha = rgba_img.split()[3]
                mask_img = ImageOps.invert(alpha)
                
            else:
                # BiRefNet variants
                model = get_birefnet_model(model_name, device)
                print(f"TrixLoader: Running BiRefNet ({model_name}) background removal...")
                
                input_size = 2048 if "HR" in model_name else 1024
                
                img_resized = img.resize((input_size, input_size), Image.BILINEAR)
                img_np = np.array(img_resized).astype(np.float32) / 255.0
                
                mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
                std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
                img_norm = (img_np - mean) / std
                
                img_tensor = torch.from_numpy(img_norm).permute(2, 0, 1).unsqueeze(0).to(device)
                
                with torch.no_grad():
                    output = model(img_tensor)
                    pred = torch.sigmoid(output[0][0, 0])
                    
                if not alpha_matting:
                    pred = (pred > 0.5).float()
                    
                mask_tensor = 1.0 - pred
                mask_np = mask_tensor.cpu().numpy()
                mask_img = Image.fromarray((mask_np * 255).astype(np.uint8), mode="L")
                mask_img = mask_img.resize(img.size, Image.BILINEAR)
                
            return mask_img

        mask_img = await asyncio.to_thread(run_inference)
        
        # Offload background removal models after execution
        offload_other_models("")
        
        buffered = BytesIO()
        mask_img.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
        
        return web.json_response({"status": "success", "mask": img_str})
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"status": "error", "error": str(e)}, status=500)


def pytorch_guided_filter(guide, src, r, eps):
    # Add batch and channel dimensions: (1, 1, H, W)
    guide = guide.unsqueeze(0).unsqueeze(0)
    src = src.unsqueeze(0).unsqueeze(0)
    
    k = 2 * r + 1
    pad = (r, r, r, r)
    
    # Replicate pad to keep boundary sizes aligned
    g_pad = torch.nn.functional.pad(guide, pad, mode='replicate')
    s_pad = torch.nn.functional.pad(src, pad, mode='replicate')
    
    mean_I = torch.nn.functional.avg_pool2d(g_pad, k, stride=1)
    mean_p = torch.nn.functional.avg_pool2d(s_pad, k, stride=1)
    mean_Ip = torch.nn.functional.avg_pool2d(g_pad * s_pad, k, stride=1)
    
    cov_Ip = mean_Ip - mean_I * mean_p
    
    mean_II = torch.nn.functional.avg_pool2d(g_pad * g_pad, k, stride=1)
    var_I = mean_II - mean_I * mean_I
    
    a = cov_Ip / (var_I + eps)
    b = mean_p - a * mean_I
    
    a_pad = torch.nn.functional.pad(a, pad, mode='replicate')
    b_pad = torch.nn.functional.pad(b, pad, mode='replicate')
    
    mean_a = torch.nn.functional.avg_pool2d(a_pad, k, stride=1)
    mean_b = torch.nn.functional.avg_pool2d(b_pad, k, stride=1)
    
    q = mean_a * guide + mean_b
    return q.squeeze().clamp(0, 1)


def pytorch_color_guided_filter(guide, src, r, eps):
    # guide: (3, H, W) or (1, 3, H, W)
    # src: (1, H, W) or (1, 1, H, W)
    if guide.ndim == 3:
        guide = guide.unsqueeze(0)
    if src.ndim == 2:
        src = src.unsqueeze(0).unsqueeze(0)
    elif src.ndim == 3:
        src = src.unsqueeze(0)
        
    N = 2 * r + 1
    pad = (r, r, r, r)
    
    def box_filter(x):
        x_pad = torch.nn.functional.pad(x, pad, mode='replicate')
        return torch.nn.functional.avg_pool2d(x_pad, N, stride=1)
        
    mean_I = box_filter(guide)
    mean_p = box_filter(src)
    
    mean_Ip = box_filter(guide * src)
    cov_Ip = mean_Ip - mean_I * mean_p
    
    I_r, I_g, I_b = guide[:, 0:1], guide[:, 1:2], guide[:, 2:3]
    mean_I_r, mean_I_g, mean_I_b = mean_I[:, 0:1], mean_I[:, 1:2], mean_I[:, 2:3]
    
    var_I_rr = box_filter(I_r * I_r) - mean_I_r * mean_I_r
    var_I_rg = box_filter(I_r * I_g) - mean_I_r * mean_I_g
    var_I_rb = box_filter(I_r * I_b) - mean_I_r * mean_I_b
    var_I_gg = box_filter(I_g * I_g) - mean_I_g * mean_I_g
    var_I_gb = box_filter(I_g * I_b) - mean_I_g * mean_I_b
    var_I_bb = box_filter(I_b * I_b) - mean_I_b * mean_I_b
    
    var_I_rr += eps
    var_I_gg += eps
    var_I_bb += eps
    
    det = (var_I_rr * (var_I_gg * var_I_bb - var_I_gb * var_I_gb) -
           var_I_rg * (var_I_rg * var_I_bb - var_I_rb * var_I_gb) +
           var_I_rb * (var_I_rg * var_I_gb - var_I_gg * var_I_rb))
           
    # Safe division by det to prevent NaN in singular/flat regions
    det_sign = torch.sign(det)
    det_sign = torch.where(det_sign == 0, torch.tensor(1.0, device=det.device), det_sign)
    safe_det = det_sign * torch.clamp(torch.abs(det), min=1e-8)
           
    inv_rr = (var_I_gg * var_I_bb - var_I_gb * var_I_gb) / safe_det
    inv_rg = -(var_I_rg * var_I_bb - var_I_rb * var_I_gb) / safe_det
    inv_rb = (var_I_rg * var_I_gb - var_I_gg * var_I_rb) / safe_det
    inv_gg = (var_I_rr * var_I_bb - var_I_rb * var_I_rb) / safe_det
    inv_gb = -(var_I_rr * var_I_gb - var_I_rg * var_I_rb) / safe_det
    inv_bb = (var_I_rr * var_I_gg - var_I_rg * var_I_rg) / safe_det
    
    cov_Ip_r, cov_Ip_g, cov_Ip_b = cov_Ip[:, 0:1], cov_Ip[:, 1:2], cov_Ip[:, 2:3]
    
    a_r = inv_rr * cov_Ip_r + inv_rg * cov_Ip_g + inv_rb * cov_Ip_b
    a_g = inv_rg * cov_Ip_r + inv_gg * cov_Ip_g + inv_gb * cov_Ip_b
    a_b = inv_rb * cov_Ip_r + inv_gb * cov_Ip_g + inv_bb * cov_Ip_b
    
    b = mean_p - (a_r * mean_I_r + a_g * mean_I_g + a_b * mean_I_b)
    
    mean_a_r = box_filter(a_r)
    mean_a_g = box_filter(a_g)
    mean_a_b = box_filter(a_b)
    mean_b = box_filter(b)
    
    q = mean_a_r * I_r + mean_a_g * I_g + mean_a_b * I_b + mean_b
    return q[0, 0].clamp(0, 1)


def decontaminate_colors(image, alpha, r=32, threshold=0.85, eps=1e-5):
    # image: (3, H, W)
    # alpha: (1, H, W)
    fg_mask = (alpha >= threshold).float()
    fg_color = image * fg_mask
    
    fg_color_4d = fg_color.unsqueeze(0)
    fg_mask_4d = fg_mask.unsqueeze(0)
    
    k = 2 * r + 1
    pad = (r, r, r, r)
    
    color_pad = torch.nn.functional.pad(fg_color_4d, pad, mode='replicate')
    mask_pad = torch.nn.functional.pad(fg_mask_4d, pad, mode='replicate')
    
    sum_color = torch.nn.functional.avg_pool2d(color_pad, k, stride=1) * (k * k)
    sum_mask = torch.nn.functional.avg_pool2d(mask_pad, k, stride=1) * (k * k)
    
    # Squeeze batch dimension to return to 3D immediately
    sum_color = sum_color.squeeze(0) # (3, H, W)
    sum_mask = sum_mask.squeeze(0) # (1, H, W)
    
    conf = torch.clamp(sum_mask * 10.0, 0.0, 1.0) # (1, H, W)
    
    decont_color = sum_color / (sum_mask + eps) # (3, H, W)
    decont_color = conf * decont_color + (1.0 - conf) * image # (3, H, W)

    # Blending: only decontaminate at transition edges (around alpha=0.5)
    w_edge = torch.clamp(1.0 - torch.abs(alpha - 0.5) / 0.5, 0.0, 1.0) # (1, H, W)
    decont_image = w_edge * decont_color + (1.0 - w_edge) * image # (3, H, W)
    return decont_image.clamp(0, 1)


def morph_boundary(mask, r):
    mask_4d = mask.unsqueeze(0).unsqueeze(0)
    k = 2 * r + 1
    pad = r
    dilated = torch.nn.functional.max_pool2d(mask_4d, kernel_size=k, stride=1, padding=pad)
    eroded = -torch.nn.functional.max_pool2d(-mask_4d, kernel_size=k, stride=1, padding=pad)
    boundary = dilated - eroded
    return boundary[0, 0].clamp(0, 1)


@PromptServer.instance.routes.post('/trix/refine_mask')
async def api_refine_mask(request):
    try:
        data = await request.json()
        image_filename = data.get("image")
        mask_b64 = data.get("mask")
        method = data.get("method") # "refine_edge" or "refine_hair"
        
        # 1. Load guide image (RGB)
        image_path = folder_paths.get_annotated_filepath(image_filename)
        img_pil = Image.open(image_path)
        img_rgb = img_pil.convert("RGB")
        
        # 2. Load mask image
        if "," in mask_b64:
            mask_b64 = mask_b64.split(",")[1]
        mask_data = base64.b64decode(mask_b64)
        mask_pil = Image.open(BytesIO(mask_data)).convert("RGBA")
        
        # Ensure guide matches mask size
        if img_rgb.size != mask_pil.size:
            img_rgb = img_rgb.resize(mask_pil.size, Image.BILINEAR)
            
        device = "cuda" if torch.cuda.is_available() else "cpu"
        
        guide_rgb_np = np.array(img_rgb).astype(np.float32) / 255.0
        guide_rgb_tensor = torch.from_numpy(guide_rgb_np).permute(2, 0, 1).to(device) # (3, H, W)
        
        mask_channels = mask_pil.split()
        mask_alpha_np = np.array(mask_channels[3]).astype(np.float32) / 255.0
        mask_tensor = torch.from_numpy(mask_alpha_np).to(device) # (H, W)
        
        # 3. Process based on method
        if method == "refine_edge":
            # Smart Color-Guided Edge Refinement:
            # 1. Compute soft boundary search zone via Distance Transform (tighter 2-pixel radius)
            cv2 = import_cv2()
            mask_uint8 = (mask_alpha_np * 255.0).astype(np.uint8)
            _, mask_bin = cv2.threshold(mask_uint8, 127, 255, cv2.THRESH_BINARY)
            
            dist_in = cv2.distanceTransform(mask_bin, cv2.DIST_L2, 5)
            inverse_mask = cv2.bitwise_not(mask_bin)
            dist_out = cv2.distanceTransform(inverse_mask, cv2.DIST_L2, 5)
            
            feathered = mask_bin.astype(np.float32)
            R = 2.0  # Tighter search window to avoid wide halos
            
            inside_idx = (mask_bin > 0) & (dist_in < R)
            feathered[inside_idx] = 128.0 + 127.0 * (dist_in[inside_idx] / R)
            
            outside_idx = (mask_bin == 0) & (dist_out < R)
            feathered[outside_idx] = 128.0 - 128.0 * (dist_out[outside_idx] / R)
            
            feathered_tensor = torch.from_numpy(feathered / 255.0).to(device)
            
            # 2. Run local Color Guided Filter (r=2, eps=1e-6) to snap boundaries tightly to RGB details
            q_tensor = pytorch_color_guided_filter(guide_rgb_tensor, feathered_tensor, r=2, eps=1e-6)
            
            # 3. Apply a tighter, crisper soft-thresholding to avoid wide grey zones
            refined_tensor = torch.clamp((q_tensor - 0.25) / 0.5, 0.0, 1.0)
            r_decont = 8
        else: # "refine_hair"
            r_gf = 6
            eps = 0.001
            r_morph = 12
            r_decont = 12
            
            # Compute grayscale guide
            guide_gray_tensor = 0.299 * guide_rgb_tensor[0] + 0.587 * guide_rgb_tensor[1] + 0.114 * guide_rgb_tensor[2]
            
            # Pre-soften the mask to reduce high-frequency ripples/halos
            mask_4d = mask_tensor.unsqueeze(0).unsqueeze(0)
            k_blur = 7
            pad_blur = 3
            soft_mask_4d = torch.nn.functional.avg_pool2d(
                torch.nn.functional.pad(mask_4d, (pad_blur, pad_blur, pad_blur, pad_blur), mode='replicate'),
                kernel_size=k_blur, stride=1
            )
            soft_mask_tensor = soft_mask_4d[0, 0]

            # Run Grayscale Guided Filter
            q_tensor = pytorch_guided_filter(guide_gray_tensor, soft_mask_tensor, r_gf, eps)
            
            # Run boundary morph
            boundary_tensor = morph_boundary(mask_tensor, r_morph)
            
            # Blend: (1 - W) * M + W * Q
            refined_tensor = (1.0 - boundary_tensor) * mask_tensor + boundary_tensor * q_tensor
            
            # Post-process: Apply soft-thresholding to clean up gray halos/smudges
            refined_tensor = torch.clamp((refined_tensor - 0.08) / 0.84, 0.0, 1.0)
        
        # Run Color Decontamination
        refined_alpha_tensor = refined_tensor.unsqueeze(0) # (1, H, W)
        decont_tensor = decontaminate_colors(guide_rgb_tensor, refined_alpha_tensor, r=r_decont, threshold=0.85)
        
        # Convert tensors back to PIL
        refined_np = (refined_tensor.cpu().numpy() * 255.0).astype(np.uint8)
        refined_alpha_pil = Image.fromarray(refined_np, mode="L")
        
        # Determine the base color of the original mask (e.g., Red, Green, or White)
        # We can look at the RGB channels of the original mask pixels that had alpha > 0
        mask_rgb = np.array(mask_pil.convert("RGB"))
        mask_a = np.array(mask_channels[3])
        
        # Default mask color is red (255, 0, 0)
        base_r, base_g, base_b = 255, 0, 0
        
        non_zero_indices = np.where(mask_a > 10)
        if len(non_zero_indices[0]) > 0:
            # Get the average color of the drawn mask pixels
            r_vals = mask_rgb[non_zero_indices[0], non_zero_indices[1], 0]
            g_vals = mask_rgb[non_zero_indices[0], non_zero_indices[1], 1]
            b_vals = mask_rgb[non_zero_indices[0], non_zero_indices[1], 2]
            
            mean_r = np.mean(r_vals)
            mean_g = np.mean(g_vals)
            mean_b = np.mean(b_vals)
            
            # Let's classify as Red, Green, White or Black based on standard colors:
            if mean_r > 128 and mean_g < 128 and mean_b < 128:
                base_r, base_g, base_b = 255, 0, 0
            elif mean_g > 128 and mean_r < 128 and mean_b < 128:
                base_r, base_g, base_b = 0, 255, 0
            elif mean_r > 200 and mean_g > 200 and mean_b > 200:
                base_r, base_g, base_b = 255, 255, 255
            elif mean_r < 50 and mean_g < 50 and mean_b < 50:
                base_r, base_g, base_b = 0, 0, 0
        
        # Colorize the output RGB channels with this base color to prevent black shadows
        h_mask, w_mask = refined_np.shape
        out_r = np.full((h_mask, w_mask), base_r, dtype=np.uint8)
        out_g = np.full((h_mask, w_mask), base_g, dtype=np.uint8)
        out_b = np.full((h_mask, w_mask), base_b, dtype=np.uint8)
        
        refined_r_pil = Image.fromarray(out_r, mode="L")
        refined_g_pil = Image.fromarray(out_g, mode="L")
        refined_b_pil = Image.fromarray(out_b, mode="L")
        
        merged_pil = Image.merge("RGBA", (refined_r_pil, refined_g_pil, refined_b_pil, refined_alpha_pil))
        
        buffered_mask = BytesIO()
        merged_pil.save(buffered_mask, format="PNG")
        mask_str = base64.b64encode(buffered_mask.getvalue()).decode("utf-8")
        
        if decont_tensor.ndim == 4:
            decont_tensor = decont_tensor.squeeze(0)
        decont_np = (decont_tensor.permute(1, 2, 0).cpu().numpy() * 255.0).astype(np.uint8)
        decont_pil = Image.fromarray(decont_np, mode="RGB")
        
        # Return decontaminated image as base64 data URL to keep disk clean
        buffered_decont = BytesIO()
        decont_pil.save(buffered_decont, format="JPEG", quality=92)
        decont_str = "data:image/jpeg;base64," + base64.b64encode(buffered_decont.getvalue()).decode("utf-8")
        
        return web.json_response({
            "status": "success",
            "mask": mask_str,
            "decont_image": decont_str
        })
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"status": "error", "error": str(e)}, status=500)

