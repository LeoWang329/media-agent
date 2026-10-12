"""Read-only SelfLift low-resolution preview. Copy this folder to custom_nodes."""

import logging
import os
from fractions import Fraction

import folder_paths
import comfy.utils
from comfy_api.latest import InputImpl, Types
from server import PromptServer


class MediaAgentSelfLiftPreview:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",), "vae": ("VAE",),
            "transition_step": ("INT", {"default": 4, "min": 1}),
            "fps": ("FLOAT", {"default": 24, "min": 1}),
            "trim_frames": ("INT", {"default": 0, "min": 0}),
            "filename_prefix": ("STRING", {"default": "media_agent_preview"}),
        }, "hidden": {"unique_id": "UNIQUE_ID"}}

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "patch"
    CATEGORY = "media-agent"

    def patch(self, model, vae, transition_step, fps, trim_frames, filename_prefix, unique_id):
        patched = model.clone()
        calls = 0

        def preview(args):
            nonlocal calls
            calls += 1
            denoised = args["denoised"]
            if calls == transition_step:
                try:
                    # SelfLift uses the last low-res x0 for its lift. Read that same
                    # prediction; do not alter it, the schedule, or the Euler update.
                    if denoised.is_nested:
                        video_latent = denoised.unbind()[0]
                    else:
                        # The post-CFG hook sees packed H3 video + audio tensors;
                        # the public sampling callback unpacks them later.
                        shapes = args["model"].latent_shapes
                        video_latent = comfy.utils.unpack_latents(denoised, shapes)[0] if shapes and len(shapes) > 1 else denoised
                    latent = model.get_model_object("latent_format").process_out(video_latent.float())
                    images = vae.decode(latent)
                    if images.ndim == 5:
                        images = images.reshape(-1, *images.shape[-3:])
                    images = images[trim_frames:].cpu()
                    video = InputImpl.VideoFromComponents(Types.VideoComponents(images=images, frame_rate=Fraction(fps)))
                    folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(
                        filename_prefix, folder_paths.get_output_directory(), images.shape[2], images.shape[1])
                    filename = f"{name}_{counter:05}_.mp4"
                    video.save_to(os.path.join(folder, filename), format=Types.VideoContainer("mp4"), codec=Types.VideoCodec("h264"), crf=28)
                    server = PromptServer.instance
                    server.send_sync("executed", {
                        "node": unique_id, "display_node": unique_id,
                        "prompt_id": server.last_prompt_id,
                        "output": {"images": [{"filename": filename, "subfolder": subfolder, "type": "output"}], "animated": [True]},
                    }, server.client_id)
                except Exception:
                    # A preview must never prevent the actual high-res result.
                    logging.exception("media-agent: low-resolution preview failed")
            return denoised

        patched.set_model_sampler_post_cfg_function(preview)
        return (patched,)


NODE_CLASS_MAPPINGS = {"MediaAgentSelfLiftPreview": MediaAgentSelfLiftPreview}
