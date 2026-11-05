import unittest

import cv2
import numpy as np

from rover.core.camera import crop_box


def jpeg(w=1280, h=960):
    img = np.zeros((h, w, 3), np.uint8)
    cv2.rectangle(img, (w // 4, h // 4), (3 * w // 4, 3 * h // 4), (255, 255, 255), -1)
    return cv2.imencode(".jpg", img)[1].tobytes()


class CropBox(unittest.TestCase):
    def test_the_box_enlarged_with_a_margin(self):
        crop = cv2.imdecode(np.frombuffer(crop_box(jpeg(), [250, 250, 750, 750]), np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(max(crop.shape[:2]), 512)
        self.assertLess(crop[5, 5].mean(), 60)  # the margin shows the dark surround
        self.assertGreater(crop[256, 256].mean(), 200)  # the middle is the white box

    def test_clamped_to_the_frame(self):
        crop = cv2.imdecode(np.frombuffer(crop_box(jpeg(), [0, 0, 1000, 1000]), np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(crop.shape[:2], (384, 512))

    def test_bad_input(self):
        with self.assertRaises(ValueError):
            crop_box(b"not a jpeg", [0, 0, 1000, 1000])
        with self.assertRaises(ValueError):
            crop_box(jpeg(), [500, 500, 502, 502])


if __name__ == "__main__":
    unittest.main()


class Sheet(unittest.TestCase):
    def sheet(self, n):
        from rover.core.camera import SHEET_COLUMNS, Camera
        cam = Camera.__new__(Camera)
        cam._wb = None
        frames = [np.full((480, 640, 3), 40 * k % 255, np.uint8) for k in range(n)]
        img = cv2.imdecode(np.frombuffer(cam.sheet(frames), np.uint8), cv2.IMREAD_COLOR)
        return img, -(-n // SHEET_COLUMNS)

    def test_a_full_scan_and_a_sweep_both_make_a_sheet(self):
        for n in (12, 7):  # 7: the look either side; the last row is padded
            img, rows = self.sheet(n)
            self.assertIsNotNone(img)
            self.assertEqual(img.shape[0] % rows, 0)
