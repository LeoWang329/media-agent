import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import MagicMock, patch


class PreviewTest(unittest.TestCase):
    def setUp(self):
        self.folder_paths = MagicMock()
        self.folder_paths.get_save_image_path.return_value = ("/output", "preview", 1, "", "preview")
        self.video = MagicMock()
        self.components = MagicMock(return_value=self.video)
        self.server = MagicMock(last_prompt_id="prompt-1", client_id="client-1")
        modules = {
            "comfy": types.ModuleType("comfy"),
            "comfy.utils": MagicMock(),
            "folder_paths": self.folder_paths,
            "comfy_api": types.ModuleType("comfy_api"),
            "comfy_api.latest": types.SimpleNamespace(InputImpl=types.SimpleNamespace(VideoFromComponents=self.components), Types=MagicMock()),
            "server": types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=self.server)),
        }
        with patch.dict(sys.modules, modules):
            spec = importlib.util.spec_from_file_location("preview_node", pathlib.Path(__file__).parents[1] / "__init__.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
        self.node = module.MediaAgentSelfLiftPreview()
        self.utils = modules["comfy.utils"]
        modules["comfy"].utils = self.utils
        self.model = MagicMock()
        self.patched = self.model.clone.return_value
        self.vae = MagicMock()
        self.images = MagicMock(ndim=4)
        self.vae.decode.return_value = self.images
        self.frames = self.images.__getitem__.return_value.cpu.return_value
        self.frames.shape = (10, 32, 64, 3)
        self.node.patch(self.model, self.vae, 4, 24, 2, "preview", "22")
        self.callback = self.patched.set_model_sampler_post_cfg_function.call_args.args[0]
        self.denoised = MagicMock(is_nested=True)
        self.latent = MagicMock()
        self.denoised.unbind.return_value = [self.latent, MagicMock()]

    def test_low_resolution_boundary_exports_once_and_preserves_prediction(self):
        for _ in range(3):
            self.assertIs(self.callback({"denoised": self.denoised}), self.denoised)
        self.vae.decode.assert_not_called()
        self.assertIs(self.callback({"denoised": self.denoised}), self.denoised)
        self.vae.decode.assert_called_once_with(self.model.get_model_object.return_value.process_out.return_value)
        self.model.get_model_object.return_value.process_out.assert_called_once_with(self.latent.float.return_value)
        self.images.__getitem__.assert_called_once_with(slice(2, None))
        self.video.save_to.assert_called_once()
        self.server.send_sync.assert_called_once()
        event, data, client = self.server.send_sync.call_args.args
        self.assertEqual((event, data["node"], data["prompt_id"], client), ("executed", "22", "prompt-1", "client-1"))
        self.assertEqual(data["output"]["images"][0]["filename"], "preview_00001_.mp4")
        for _ in range(4):
            self.assertIs(self.callback({"denoised": self.denoised}), self.denoised)
        self.video.save_to.assert_called_once()
        self.model.set_model_sampler_post_cfg_function.assert_not_called()

    def test_preview_failure_does_not_stop_high_resolution_sampling(self):
        self.video.save_to.side_effect = RuntimeError("encoder unavailable")
        with self.assertLogs(level="ERROR"):
            for _ in range(4):
                self.assertIs(self.callback({"denoised": self.denoised}), self.denoised)
        self.server.send_sync.assert_not_called()
        self.assertIs(self.callback({"denoised": self.denoised}), self.denoised)

    def test_batched_video_decode_is_flattened_before_trimming_context(self):
        self.images.ndim = 5
        self.images.shape = (1, 12, 32, 64, 3)
        flat = self.images.reshape.return_value
        flat.__getitem__.return_value.cpu.return_value = self.frames
        for _ in range(4):
            self.callback({"denoised": self.denoised})
        self.images.reshape.assert_called_once_with(-1, 32, 64, 3)
        flat.__getitem__.assert_called_once_with(slice(2, None))
        self.video.save_to.assert_called_once()

    def test_h3_post_cfg_hook_unpacks_video_from_packed_audio_video(self):
        self.denoised.is_nested = False
        inner = MagicMock(latent_shapes=[(1, 16, 57, 24, 32), (1, 8, 121)])
        self.utils.unpack_latents.return_value = [self.latent, MagicMock()]
        for _ in range(4):
            self.assertIs(self.callback({"denoised": self.denoised, "model": inner}), self.denoised)
        self.utils.unpack_latents.assert_called_once_with(self.denoised, inner.latent_shapes)
        self.model.get_model_object.return_value.process_out.assert_called_once_with(self.latent.float.return_value)
        self.video.save_to.assert_called_once()


if __name__ == "__main__":
    unittest.main()
