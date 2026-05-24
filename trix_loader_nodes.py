import os
import torch
import numpy as np
import json
from PIL import Image, ImageOps, ImageFilter, ImageDraw, ImageEnhance
import folder_paths
import node_helpers
from io import BytesIO
from server import PromptServer 
import base64

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
❂ COLOR GRADING [MAIN]
➥ Dbl-Click tab to open Camera Raw menu
➥ Toggle "Enable Filter" to unlock dimension settings
➥ Click "Live Camera Raw" for visual adjustments

✎ MASKING [MASK]
➥ Dbl-Click tab: Fullscreen Mode
➥ Alt + RMB (Drag): Resize Brush & Hardness
➥ Ctrl + Click: Smart Flood Fill
➥ Shift + Click: Line Tool

回 RESIZING & CROPPING [RESIZE] 
➥ Toggle "Enable Resize" to unlock dimension settings
➥ Click "Open CPO Editor" for visual cropping/padding

★ PRO TIP: Right-click the node to directly Copy/Paste-Images/Masks!"""

    RETURN_TYPES = ("IMAGE", "MASK", "IMAGE")
    RETURN_NAMES = ("IMAGE", "MASK", "original_input")
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

    def process(self, image, width, height, pad_left, pad_top, pad_right, pad_bottom, upscale_method, keep_proportion, scale_by, condition, feathering, divisible_by, enable_resize, mode, mask_data, crop_data="{}", hsl_data="{}", hsl_active=False, curve_data="{}", curve_active=False, in_image=None, in_mask=None, unique_id=None, **kwargs):
        
        ui_images = None
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
            image_path = folder_paths.get_annotated_filepath(image)
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
            in_m = in_mask[0].cpu().numpy() * 255.0
            base_mask_img = Image.fromarray(np.clip(in_m, 0, 255).astype(np.uint8), mode="L")
            if base_mask_img.size != img.size:
                base_mask_img = base_mask_img.resize(img.size, Image.NEAREST)
        else:
            base_mask_img = Image.new("L", img.size, 0)

        mask_combined_np = np.maximum(np.array(base_mask_img), np.array(file_mask_img))

        if mask_data and mask_data.startswith("data:image"):
            try:
                base64_data = mask_data.split(",")[1]
                drawn_img = Image.open(BytesIO(base64.b64decode(base64_data))).convert("RGBA")
                if drawn_img.size != img.size:
                    drawn_img = drawn_img.resize(img.size, Image.BILINEAR)
                
                drawn_np = np.array(drawn_img)[:, :, 3].astype(np.uint8)
                mask_combined_np = np.maximum(mask_combined_np, drawn_np)
            except Exception as e:
                pass
                
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
                
                new_img = Image.new("RGB", (target_w, target_h), (127, 127, 127))
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
                        img = Image.new("RGB", (target_w, target_h), (0, 0, 0))
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
