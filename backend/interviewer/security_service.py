import os
import sys

# Configure stdout and stderr to handle UTF-8 to prevent DeepFace emoji log encoding crashes on Windows
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

import base64
import tempfile
import cv2
import numpy as np
from django.conf import settings

# Lazy loading helpers for heavy optional libraries
_deepface_tried = False
_DeepFace = None

def _get_deepface():
    global _deepface_tried, _DeepFace
    if not _deepface_tried:
        try:
            from deepface import DeepFace
            _DeepFace = DeepFace
        except Exception as e:
            print(f"Error importing DeepFace: {e}")
            _DeepFace = None
        _deepface_tried = True
    return _DeepFace

_mediapipe_tried = False
_mp = None
_face_mesh_detector = None

def _get_mediapipe():
    global _mediapipe_tried, _mp
    if not _mediapipe_tried:
        try:
            import mediapipe as mp
            _mp = mp
        except ImportError:
            _mp = None
        _mediapipe_tried = True
    return _mp

def _get_mediapipe_detector():
    global _face_mesh_detector
    mp = _get_mediapipe()
    if mp is not None and _face_mesh_detector is None:
        try:
            from mediapipe.tasks import python
            from mediapipe.tasks.python import vision
            
            # Resolve model asset path dynamically (in the workspace root)
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            model_path = os.path.join(base_dir, 'face_landmarker.task')
            
            if os.path.exists(model_path):
                base_options = python.BaseOptions(model_asset_path=model_path)
                options = vision.FaceLandmarkerOptions(
                    base_options=base_options,
                    output_face_blendshapes=True,
                    output_facial_transformation_matrixes=True,
                    num_faces=4
                )
                _face_mesh_detector = vision.FaceLandmarker.create_from_options(options)
        except Exception as e:
            print(f"Error loading MediaPipe FaceLandmarker: {e}")
            _face_mesh_detector = None
    return _face_mesh_detector

def preload_heavy_libraries():
    """
    Preloads DeepFace and MediaPipe FaceLandmarker models into memory to prevent lags during live proctoring.
    """
    print("[Preload] Starting preloading of DeepFace and MediaPipe FaceLandmarker...")
    df = _get_deepface()
    if df is not None:
        print("[Preload] DeepFace imported successfully.")
        try:
            # Warm up Facenet and Emotion models by building them to prevent first-frame lag
            print("[Preload] Warming up Facenet and Emotion models...")
            df.build_model("Facenet")
            df.build_model("Emotion", task="facial_attribute")
            print("[Preload] Facenet and Emotion models warmed up successfully.")
        except Exception as e:
            print(f"[Preload] Warning: Could not warm up DeepFace models: {e}")
    else:
        print("[Preload] DeepFace is not installed or failed to import.")
        
    mp_det = _get_mediapipe_detector()
    mp = _get_mediapipe()
    if mp_det is not None and mp is not None:
        print("[Preload] MediaPipe FaceLandmarker initialized successfully. Warming up model...")
        try:
            # Run a dummy frame through the model to compile shaders/buffers and avoid first-frame lag
            dummy_img = np.zeros((100, 100, 3), dtype=np.uint8)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=dummy_img)
            mp_det.detect(mp_image)
            print("[Preload] MediaPipe FaceLandmarker model warmed up successfully.")
        except Exception as e:
            print(f"[Preload] Warning: Could not warm up MediaPipe FaceLandmarker: {e}")
    else:
        print("[Preload] MediaPipe FaceLandmarker failed to initialize.")
    print("[Preload] Preloading finished.")

def _load_cascade(filename):
    # Try absolute path first (default)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + filename)
    if not cascade.empty():
        return cascade
    
    # Try relative path through venv (avoids spaces in path bugs on Windows)
    rel_path = os.path.join('venv', 'Lib', 'site-packages', 'cv2', 'data', filename)
    if os.path.exists(rel_path):
        cascade = cv2.CascadeClassifier(rel_path)
        if not cascade.empty():
            return cascade

    # Try relative path direct if files are copied locally
    if os.path.exists(filename):
        cascade = cv2.CascadeClassifier(filename)
        if not cascade.empty():
            return cascade

    print(f"Warning: Could not load Haar cascade {filename}")
    return cascade

# Load Haar cascades for extremely lightweight CPU-based detection
face_cascade = _load_cascade('haarcascade_frontalface_default.xml')
profile_cascade = _load_cascade('haarcascade_profileface.xml')
eye_cascade = _load_cascade('haarcascade_eye.xml')

def detect_faces_opencv(img):
    """
    Detects the number of faces in an image using OpenCV Haar cascades.
    Checks frontal faces and falls back to profile faces if zero frontal faces are seen.
    Returns:
        dict: {
            "face_detected": bool,
            "face_count": int,
            "looking_away_detected": bool
        }
    """
    if img is None:
        return {"face_detected": False, "face_count": 0, "looking_away_detected": False}
        
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Detect frontal faces
    frontal_faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
    face_count = len(frontal_faces)
    looking_away_detected = False
    
    if face_count == 0:
        # Check for profile faces (sideways profile, looking away)
        profile_faces = profile_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
        profile_count = len(profile_faces)
        if profile_count > 0:
            face_count = profile_count
            looking_away_detected = True
    # Frontal face was found, so we assume facing forward since profile face check was skipped.
    # We removed the eye cascade check to avoid false alarms due to glasses or poor lighting.
                
    return {
        "face_detected": face_count > 0,
        "face_count": face_count,
        "looking_away_detected": looking_away_detected
    }

def decode_base64_to_cv2(live_image_base64):
    """Utility to convert a base64 camera frame into a cv2 BGR image."""
    if not live_image_base64:
        return None
    try:
        if "," in live_image_base64:
            live_image_base64 = live_image_base64.split(",")[1]
        img_bytes = base64.b64decode(live_image_base64)
        np_arr = np.frombuffer(img_bytes, dtype=np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        return img
    except Exception:
        return None

def estimate_head_pose(img):
    """
    Computes candidate's head orientation (pitch, yaw, roll) using MediaPipe Tasks FaceLandmarker,
    with a fallback to OpenCV Haar Cascades if MediaPipe is unavailable or fails.
    """
    if img is None:
        return {
            "face_detected": False,
            "pitch": 0.0,
            "yaw": 0.0,
            "roll": 0.0,
            "looking_away": False,
            "face_count": 0,
            "ear": 0.0,
            "blink_detected": False,
            "landmarks": []
        }

    # 1. Attempt to run MediaPipe FaceLandmarker first (highly accurate, immune to space-in-path bugs)
    detector = _get_mediapipe_detector()
    mp = _get_mediapipe()

    if detector is not None and mp is not None:
        try:
            h, w, _ = img.shape
            # Downscale image to a standard width of 320px for faster processing
            target_w = 320
            if w > target_w:
                scale = target_w / w
                target_h = int(h * scale)
                img = cv2.resize(img, (target_w, target_h), interpolation=cv2.INTER_AREA)
                h, w, _ = img.shape

            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=img_rgb)
            
            result = detector.detect(mp_image)

            if result.face_landmarks:
                face_landmarks = result.face_landmarks[0]
                face_count = len(result.face_landmarks)

                # Calculate Eye Aspect Ratio (EAR) for both eyes
                p_left_top = np.array([face_landmarks[159].x * w, face_landmarks[159].y * h])
                p_left_bot = np.array([face_landmarks[145].x * w, face_landmarks[145].y * h])
                p_left_l   = np.array([face_landmarks[33].x * w, face_landmarks[33].y * h])
                p_left_r   = np.array([face_landmarks[133].x * w, face_landmarks[133].y * h])
                
                dist_left_v = np.linalg.norm(p_left_top - p_left_bot)
                dist_left_h = np.linalg.norm(p_left_l - p_left_r)
                ear_left = dist_left_v / max(0.1, dist_left_h)
                
                p_right_top = np.array([face_landmarks[386].x * w, face_landmarks[386].y * h])
                p_right_bot = np.array([face_landmarks[374].x * w, face_landmarks[374].y * h])
                p_right_l   = np.array([face_landmarks[362].x * w, face_landmarks[362].y * h])
                p_right_r   = np.array([face_landmarks[263].x * w, face_landmarks[263].y * h])
                
                dist_right_v = np.linalg.norm(p_right_top - p_right_bot)
                dist_right_h = np.linalg.norm(p_right_l - p_right_r)
                ear_right = dist_right_v / max(0.1, dist_right_h)
                
                ear = float((ear_left + ear_right) / 2.0)
                blink_detected = ear < 0.20

                # Key coordinates for photo detection
                coords = [[round(face_landmarks[idx].x, 5), round(face_landmarks[idx].y, 5), round(face_landmarks[idx].z, 5)] for idx in [1, 33, 263, 61, 291, 199]]

                # Boundary ratio-based head pose estimation (100% stable, noise-free, zero camera dependency)
                lm_left = face_landmarks[234]
                lm_right = face_landmarks[454]
                lm_top = face_landmarks[10]
                lm_bot = face_landmarks[152]
                lm_nose = face_landmarks[1]

                left_dist = abs(lm_nose.x - lm_left.x)
                right_dist = abs(lm_right.x - lm_nose.x)
                total_width = left_dist + right_dist
                horizontal_ratio = left_dist / max(1e-6, total_width)

                top_dist = abs(lm_nose.y - lm_top.y)
                bot_dist = abs(lm_bot.y - lm_nose.y)
                total_height = top_dist + bot_dist
                vertical_ratio = top_dist / max(1e-6, total_height)

                # Center ratios: horizontal center is exactly 0.5, vertical center is typically ~0.44
                yaw = (horizontal_ratio - 0.5) * 180.0
                pitch = (vertical_ratio - 0.44) * 180.0
                roll = 0.0

                pitch = float(pitch)
                yaw = float(yaw)

                # Define specific angle limits for looking away:
                # - Yaw (left/right): 25.0 degrees (reduced to 25 degrees)
                # - Pitch Down (looking down): > 35.0 degrees
                # - Pitch Up (looking up): < -35.0 degrees
                looking_away = abs(yaw) > 25.0 or pitch > 35.0 or pitch < -35.0

                return {
                    "face_detected": True,
                    "pitch": pitch,
                    "yaw": yaw,
                    "roll": roll,
                    "looking_away": looking_away,
                    "face_count": face_count,
                    "ear": ear,
                    "blink_detected": blink_detected,
                    "landmarks": coords,
                    "face_box": [float(lm_left.x), float(lm_top.y), float(lm_right.x), float(lm_bot.y)]
                }
        except Exception as e:
            print(f"Error running MediaPipe: {e}")

    # 2. Fallback to OpenCV Haar Cascades if MediaPipe is unavailable or fails to find face landmarks
    opencv_res = detect_faces_opencv(img)
    face_count = opencv_res["face_count"]

    if face_count == 0:
        return {
            "face_detected": False,
            "pitch": 0.0,
            "yaw": 0.0,
            "roll": 0.0,
            "looking_away": False,
            "face_count": 0,
            "ear": 0.0,
            "blink_detected": False,
            "landmarks": [],
            "face_box": None
        }

    if face_count > 1:
        return {
            "face_detected": True,
            "pitch": 0.0,
            "yaw": 0.0,
            "roll": 0.0,
            "looking_away": False,
            "face_count": face_count,
            "ear": 0.0,
            "blink_detected": False,
            "landmarks": [],
            "face_box": None
        }

    return {
        "face_detected": True,
        "pitch": 0.0,
        "yaw": 0.0,
        "roll": 0.0,
        "looking_away": opencv_res["looking_away_detected"],
        "face_count": 1,
        "ear": 0.0,
        "blink_detected": False,
        "landmarks": [],
        "face_box": None
    }


def analyze_emotion(img, is_cropped=False):
    """
    Runs DeepFace emotion analytics on the decoded cv2 image frame.
    
    Returns:
        dict: {
            "emotion": str (e.g. 'neutral', 'sad', 'fear', 'happy'),
            "nervousness_score": float (0-100 based on fear & surprise probabilities)
        }
    """
    if img is None or img.size == 0:
        return {"emotion": "neutral", "nervousness_score": 0.0}

    DeepFace = _get_deepface()
    if DeepFace is None:
        return {
            "emotion": "neutral",
            "nervousness_score": 0.0
        }

    try:
        emotion = "neutral"
        nervousness_score = 0.0
        backend = "skip" if is_cropped else "opencv"
        analysis_result = DeepFace.analyze(
            img_path=img,
            actions=["emotion"],
            detector_backend=backend,
            enforce_detection=False
        )
        if isinstance(analysis_result, list):
            analysis_result = analysis_result[0]
        
        emotions_dict = analysis_result.get("emotion", {})
        emotion = analysis_result.get("dominant_emotion", "neutral")
        
        # Nervousness is proxied by fear, surprise, and sadness
        fear_val = emotions_dict.get("fear", 0.0)
        surprise_val = emotions_dict.get("surprise", 0.0)
        sad_val = emotions_dict.get("sad", 0.0)
        nervousness_score = float(round(fear_val * 0.5 + surprise_val * 0.3 + sad_val * 0.2, 1))
        
        return {
            "emotion": emotion,
            "nervousness_score": nervousness_score
        }
    except Exception as e:
        print(f"DeepFace analyze error in analyze_emotion: {e}")
        return {"emotion": "neutral", "nervousness_score": 0.0}


def analyze_expression_and_identity(registered_image_path, img, model_name="Facenet"):
    """
    Runs DeepFace verification and emotion analytics on the decoded cv2 image frame.
    
    Returns:
        dict: {
            "verified": bool,
            "distance": float,
            "threshold": float,
            "emotion": str (e.g. 'neutral', 'sad', 'fear', 'happy'),
            "nervousness_score": float (0-100 based on fear & surprise probabilities)
        }
    """
    if img is None:
        return {"verified": False, "distance": 1.0, "threshold": 0.10, "emotion": "unknown", "nervousness_score": 0.0}

    DeepFace = _get_deepface()
    if DeepFace is None:
        # Fallback when DeepFace is not installed (fail securely)
        return {
            "verified": False,
            "distance": 1.0,
            "threshold": 0.10,
            "error": "Face verification engine (DeepFace) is not installed on the server.",
            "emotion": "neutral",
            "nervousness_score": 0.0
        }

    try:
        # Identity Verification using numpy array directly (extremely fast, zero disk I/O)
        verified = False
        distance = 1.0
        threshold = 0.10
        if registered_image_path and os.path.exists(registered_image_path):
            try:
                verify_result = DeepFace.verify(
                    img1_path=registered_image_path,
                    img2_path=img,
                    model_name=model_name,
                    detector_backend="opencv",
                    enforce_detection=False
                )
                verified = bool(verify_result.get("verified", False))
                distance = float(verify_result.get("distance", 1.0))
                threshold = float(verify_result.get("threshold", 0.10))
            except Exception as e:
                print(f"DeepFace verify error: {e}")

        # Standalone Emotion Analysis
        emotion_res = analyze_emotion(img)

        return {
            "verified": verified,
            "distance": distance,
            "threshold": threshold,
            "emotion": emotion_res["emotion"],
            "nervousness_score": emotion_res["nervousness_score"]
        }
    except Exception as e:
        print(f"Error in analyze_expression_and_identity: {e}")
        return {"verified": False, "distance": 1.0, "threshold": 0.10, "emotion": "neutral", "nervousness_score": 0.0}

def verify_candidate_face(registered_image_path, live_image_base64, model_name="Facenet"):
    """
    Fallback support for initial face verification step.
    """
    img = decode_base64_to_cv2(live_image_base64)
    res = analyze_expression_and_identity(registered_image_path, img, model_name=model_name)
    ret = {
        "verified": res["verified"],
        "distance": res.get("distance", 1.0),
        "threshold": res.get("threshold", 0.10)
    }
    if "error" in res:
        ret["error"] = res["error"]
    return ret
