from .trix_loader_nodes import TrixLoadImageAIO

NODE_CLASS_MAPPINGS = {
    "TrixLoadImageAIO": TrixLoadImageAIO
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "TrixLoadImageAIO": "🌊Load Image AIO"
}

# Указываем ComfyUI, где искать кастомные скрипты для интерфейса.
WEB_DIRECTORY = "./web"

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']
