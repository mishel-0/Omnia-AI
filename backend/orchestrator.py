"""
Omnia AI - Aria Orchestrator
Multi-bot task queue system with 10 worker bots and DeepSeek-powered clinical report generation.
"""
from __future__ import annotations

import io
import os
import sys
import json
import uuid
import time
import math
import base64
import logging
import subprocess
import threading
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, Future
from typing import Any, Optional

import numpy as np
from PIL import Image
from urllib.request import Request, urlopen
from urllib.error import URLError

# ────────────────────────────────────────────────────────────
# Imports from main.py (the Aria backend)
# ────────────────────────────────────────────────────────────
sys.path.insert(0, os.path.dirname(__file__))
import main as aria_main

from main import (
    model,
    DEVICE,
    CLASS_LABELS,
    transform,
    get_prediction,
    generate_heatmap,
    load_image_from_bytes,
)

logger = logging.getLogger("aria-orchestrator")

# ────────────────────────────────────────────────────────────
# DeepSeek Client
# ────────────────────────────────────────────────────────────
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "sk-7d0f5c7564484b1ebae86586e206beb2")
DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"
DEEPSEEK_MODEL = "deepseek-v4-flash"


class DeepSeekClient:
    """Lightweight client for DeepSeek chat completions API."""

    def __init__(
        self,
        api_key: str = DEEPSEEK_API_KEY,
        api_url: str = DEEPSEEK_API_URL,
        model: str = DEEPSEEK_MODEL,
    ):
        self.api_key = api_key
        self.api_url = api_url
        self.model = model

    def _call_api(self, messages: list[dict], max_tokens: int = 2048) -> str:
        """Make a synchronous API call to DeepSeek."""
        payload = json.dumps({
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.3,
        }).encode("utf-8")

        req = Request(
            self.api_url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
            method="POST",
        )

        try:
            with urlopen(req, timeout=60) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                return body["choices"][0]["message"]["content"]
        except URLError as e:
            logger.error(f"DeepSeek API call failed: {e}")
            raise
        except (KeyError, IndexError, json.JSONDecodeError) as e:
            logger.error(f"DeepSeek API unexpected response: {e}")
            raise RuntimeError(f"DeepSeek API error: {e}")

    def generate_report(
        self,
        analysis: dict,
        patient: dict,
        smoking_history: str | None = None,
        clinical_indication: str | None = None,
    ) -> dict:
        """Generate an intelligent clinical radiology report via DeepSeek.

        Falls back to a locally-generated structured report if the API is unavailable.
        """
        prediction = analysis.get("prediction", "Unknown")
        confidence_pct = analysis.get("confidence_pct", 0)
        risk_level = analysis.get("risk_level", "Unknown")
        recommendation = analysis.get("recommendation", "")
        all_scores = analysis.get("all_scores", [])
        suspicious_regions = analysis.get("suspicious_regions", [])
        lesion_size_mm = analysis.get("lesion_size_mm")
        lesion_volume_mm3 = analysis.get("lesion_volume_mm3")

        patient_name = patient.get("patient_name", "Patient")
        patient_age = patient.get("patient_age", "Unknown")
        patient_sex = patient.get("patient_sex", "Unknown")
        modality = patient.get("modality", "Unknown")
        study_date = patient.get("study_date", "Unknown")

        scores_str = "; ".join(
            [f"{s.get('class', '?')}: {s.get('score', 0)}%" for s in all_scores]
        )

        regions_str = ""
        if suspicious_regions:
            for i, r in enumerate(suspicious_regions, 1):
                area = r.get("area_px", r.get("area", 0))
                regions_str += f"  Region {i}: intensity={r.get('intensity', 'N/A')}, area={area}px"
                if lesion_size_mm and lesion_volume_mm3:
                    regions_str += f" (~{lesion_size_mm}mm diameter, ~{lesion_volume_mm3}mm³ volume)"
                regions_str += "\n"

        smoking_str = f"\nSmoking History: {smoking_history}\n" if smoking_history else "\nSmoking History: Not provided\n"
        indication_str = f"Clinical Indication: {clinical_indication}\n" if clinical_indication else "Clinical Indication: Not provided\n"

        system_prompt = (
            "You are a clinical radiology AI assistant. Your role is to generate "
            "clear, actionable, age-adjusted clinical reports from AI-based imaging analysis data. "
            "You must tailor your findings and recommendations to the patient's age and demographics. "
            "Provide your response as a valid JSON object with exactly these keys:\n"
            "  - narrative_summary (string): A concise paragraph explaining the findings in clinical terms.\n"
            "  - risk_factors (list of strings): Age-adjusted risk factors and clinical considerations.\n"
            "  - followup_recommendations (list of strings): Specific follow-up steps tailored to the patient's age and findings.\n"
            "  - confidence_assessment (string): A brief assessment of diagnostic confidence given the AI scores.\n"
            "  - patient_context (string): Explanation of how the patient's age and demographics affect the interpretation.\n"
            "  - differential_diagnoses (list of strings): A list of possible differential diagnoses based on the imaging findings.\n"
            "  - fleischner_class (string or null): Fleischner Society nodule classification category (e.g., 'Perifissural', 'Subsolid <6mm', 'Solid 6-8mm', etc.) OR null if not applicable.\n"
            "Return ONLY valid JSON, no markdown fences, no extra text."
        )

        user_prompt = (
            f"Generate a clinical radiology report for the following case:\n\n"
            f"--- Patient Information ---\n"
            f"Name: {patient_name}\n"
            f"Age: {patient_age}\n"
            f"Sex: {patient_sex}\n"
            f"Modality: {modality}\n"
            f"Study Date: {study_date}\n"
            f"{smoking_str}"
            f"{indication_str}"
            f"--- AI Analysis Results ---\n"
            f"Prediction: {prediction}\n"
            f"Confidence: {confidence_pct}%\n"
            f"Risk Level: {risk_level}\n"
            f"All Scores: {scores_str}\n"
            f"System Recommendation: {recommendation}\n"
            f"--- Suspicious Regions ---\n"
            f"{regions_str if regions_str else 'No suspicious regions detected.'}\n"
            f"--- Lesion Size ---\n"
            f"{('Estimated diameter: %s mm, Estimated volume: %s mm³' % (lesion_size_mm, lesion_volume_mm3)) if lesion_size_mm else 'Not estimated'}\n\n"
            f"--- Fleischner Guidelines ---\n"
            f"If the prediction is 'Malignant' or 'Benign' with pulmonary nodule findings, "
            f"please include Fleischner Society follow-up recommendations based on the nodule size. "
            f"Classify the nodule according to Fleischner guidelines and provide recommended follow-up intervals.\n\n"
            f"Please provide age-adjusted clinical insights, considering the patient's age ({patient_age}) "
            f"and sex ({patient_sex}) when interpreting the findings. "
            f"Also suggest possible differential diagnoses based on the imaging characteristics."
        )

        try:
            raw = self._call_api([
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ])
        except Exception as e:
            logger.warning(f"DeepSeek API unavailable ({e}), using locally-generated fallback report")
            return self._local_fallback(analysis, patient, smoking_history=smoking_history, clinical_indication=clinical_indication)

        # Robust JSON extraction
        try:
            result = json.loads(raw)
        except json.JSONDecodeError:
            # Try to find JSON inside markdown fences or braces
            import re
            match = re.search(r'\{[\s\S]*\}', raw)
            if match:
                try:
                    result = json.loads(match.group())
                except json.JSONDecodeError:
                    result = self._local_fallback(analysis, patient, smoking_history=smoking_history, clinical_indication=clinical_indication)
            else:
                result = self._local_fallback(analysis, patient, smoking_history=smoking_history, clinical_indication=clinical_indication)

        # Ensure all keys present
        defaults = {
            "narrative_summary": "",
            "risk_factors": [],
            "followup_recommendations": [],
            "confidence_assessment": "",
            "patient_context": "",
            "differential_diagnoses": [],
            "fleischner_class": None,
        }
        for k, v in defaults.items():
            if k not in result:
                result[k] = v

        return result

    def _local_fallback(
        self,
        analysis: dict,
        patient: dict,
        smoking_history: str | None = None,
        clinical_indication: str | None = None,
    ) -> dict:
        """Generate a structured clinical report locally when DeepSeek API is unavailable.
        
        This provides clinically meaningful output based on the analysis data itself,
        so the system remains functional even without internet access.
        """
        prediction = analysis.get("prediction", "Unknown")
        confidence_pct = analysis.get("confidence_pct", 0)
        risk_level = analysis.get("risk_level", "None")
        recommendation = analysis.get("recommendation", "")
        all_scores = analysis.get("all_scores", [])
        suspicious_regions = analysis.get("suspicious_regions", [])
        lesion_size_mm = analysis.get("lesion_size_mm")
        lesion_volume_mm3 = analysis.get("lesion_volume_mm3")

        patient_age = patient.get("patient_age", "Unknown")
        patient_sex = patient.get("patient_sex", "Unknown")

        # Build narrative summary
        if prediction == "Malignant":
            narrative = (
                f"The AI analysis of the {patient.get('modality', 'imaging')} study shows findings "
                f"consistent with a Malignant classification at {confidence_pct}% confidence. "
                f"The model detected significant abnormal features warranting immediate clinical attention. "
                f"{recommendation}"
            )
            risk_factors_list = [
                f"Age-adjusted risk: Patient age {patient_age} falls in a demographic where malignancy risk requires careful evaluation",
                f"High-confidence AI detection ({confidence_pct}%) suggests significant pathological findings",
                "Tissue characterization indicates features associated with aggressive pathology",
            ]
            followup = [
                "Immediate specialist (oncologist/radiologist) consultation recommended",
                "Biopsy and histopathological confirmation advised",
                "Complete staging workup including additional imaging as clinically indicated",
                f"Age-specific ({patient_age}) follow-up protocol should be established",
            ]
        elif prediction == "Benign":
            narrative = (
                f"The AI analysis of the {patient.get('modality', 'imaging')} study reveals findings "
                f"consistent with a Benign classification at {confidence_pct}% confidence. "
                f"The model identified non-malignant characteristics. "
                f"{recommendation}"
            )
            risk_factors_list = [
                f"Patient age {patient_age} - benign findings are common but should be monitored",
                f"AI confidence at {confidence_pct}% supports radiographic benign特征",
                "No malignant features detected in the analyzed regions",
            ]
            followup = [
                "Routine follow-up per standard protocol for benign findings",
                f"Age-appropriate screening should continue per guidelines for a {patient_age}-year-old {patient_sex}",
                "No immediate intervention required; clinical correlation recommended",
            ]
        else:  # Normal
            narrative = (
                f"The AI analysis of the {patient.get('modality', 'imaging')} study shows no abnormalities detected. "
                f"The model classified this case as Normal with {confidence_pct}% confidence. "
                f"{recommendation}"
            )
            risk_factors_list = [
                f"Patient age {patient_age} - normal findings are reassuring in this demographic",
                "No suspicious features identified on AI analysis",
                "Low risk profile based on current imaging",
            ]
            followup = [
                "Continue standard age-appropriate screening protocols",
                f"For a {patient_age}-year-old {patient_sex}, maintain routine surveillance as per guidelines",
                "No additional imaging required at this time",
            ]

        # Build scores string for confidence assessment
        scores_str_local = "; ".join([f"{s.get('class', '?')}: {s.get('score', 0)}%" for s in all_scores])
        confidence = (
            f"AI model confidence: {confidence_pct}% ({risk_level} risk). "
            f"Model scores: {scores_str_local}. "
            f"This represents {'high' if confidence_pct > 85 else 'moderate' if confidence_pct > 70 else 'low'} diagnostic certainty."
        )

        patient_context = (
            f"Patient is a {patient_age}-year-old {patient_sex}. "
            f"Age-adjusted interpretation: For {patient_sex} patients aged {patient_age}, "
            f"the clinical significance of {'malignant' if prediction == 'Malignant' else 'benign' if prediction == 'Benign' else 'normal'} "
            f"findings should be considered within the context of age-specific prevalence rates, "
            f"comorbidities, and screening guidelines. "
            f"This AI analysis provides a probabilistic assessment that should be integrated "
            f"with full clinical history and physical examination."
        )

        # Determine Fleischner classification and differentials based on nodule size
        fleischner_class = None
        differential_diagnoses = []
        has_nodule = prediction in ("Malignant", "Benign") and suspicious_regions

        if has_nodule and lesion_size_mm is not None:
            if lesion_size_mm < 6:
                fleischner_class = "Solid <6mm (low risk)"
                followup.append(
                    f"Fleischner Society (solid nodule <6mm): No routine follow-up needed for low-risk patients; "
                    f"consider optional CT at 12 months for high-risk patients."
                )
                differential_diagnoses = [
                    "Benign intrapulmonary lymph node",
                    "Perifissural nodule",
                    "Granuloma",
                    "Early primary lung malignancy (low probability)",
                ]
            elif lesion_size_mm < 9:
                fleischner_class = "Solid 6-8mm"
                followup.append(
                    f"Fleischner Society (solid nodule 6-8mm): CT follow-up at 6-12 months, "
                    f"then consider CT at 18-24 months."
                )
                differential_diagnoses = [
                    "Primary lung malignancy (T1a stage)",
                    "Carcinoid tumor",
                    "Granulomatous disease",
                    "Hamartoma",
                    "Metastatic lesion",
                ]
            else:
                fleischner_class = "Solid >8mm"
                followup.append(
                    f"Fleischner Society (solid nodule >8mm): CT at 3-6 months, consider PET/CT, "
                    f"biopsy, or further evaluation depending on clinical risk profile."
                )
                differential_diagnoses = [
                    "Primary lung malignancy (T1b or higher)",
                    "Metastatic disease",
                    "Carcinoid tumor",
                    "Infectious/inflammatory mass",
                    "Lymphoma (rare solitary presentation)",
                ]
        elif has_nodule:
            differential_diagnoses = [
                "Pulmonary nodule of uncertain significance",
                "Granulomatous disease",
                "Neoplastic process (malignant or benign)",
                "Inflammatory pseudotumor",
            ]

        # Add smoking history and clinical indication to patient context
        clinical_context_note = ""
        if smoking_history:
            clinical_context_note += f" Smoking history: {smoking_history}."
        if clinical_indication:
            clinical_context_note += f" Clinical indication: {clinical_indication}."
        if clinical_context_note:
            patient_context += clinical_context_note

        return {
            "narrative_summary": narrative,
            "risk_factors": risk_factors_list,
            "followup_recommendations": followup,
            "confidence_assessment": confidence,
            "patient_context": patient_context,
            "differential_diagnoses": differential_diagnoses,
            "fleischner_class": fleischner_class,
        }


# ────────────────────────────────────────────────────────────
# Aria Orchestrator
# ────────────────────────────────────────────────────────────

class AriaOrchestrator:
    """Multi-bot task queue for Omnia AI medical imaging analysis."""

    _executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="aria-bot")
    _results: dict[str, dict] = {}
    _futures: dict[str, Future] = {}
    _start_time = time.time()
    _batch_progress: dict[str, dict] = {}
    _audit_log: list[dict] = []
    _analysis_times: dict[str, float] = {}

    # ── Task management ──────────────────────────────────────

    @classmethod
    def submit_task(cls, task_type: str, **kwargs) -> str:
        """Submit a task to the worker pool. Returns a task ID."""
        task_id = str(uuid.uuid4())
        cls._results[task_id] = {"status": "pending", "task_type": task_type}

        bot_method = getattr(cls, f"bot_{task_type}", None)
        if bot_method is None:
            cls._results[task_id] = {
                "status": "failed",
                "error": f"Unknown task type: {task_type}",
            }
            return task_id

        future = cls._executor.submit(cls._run_bot, task_id, bot_method, **kwargs)
        cls._futures[task_id] = future
        return task_id

    @classmethod
    def get_result(cls, task_id: str) -> dict:
        """Get the result of a task by ID. Non-blocking; returns current state."""
        result = cls._results.get(task_id)
        if result is None:
            return {"status": "not_found", "error": f"No task found with id {task_id}"}

        future = cls._futures.get(task_id)
        if future is not None and future.done() and result.get("status") == "running":
            try:
                cls._results[task_id] = future.result()
            except Exception as e:
                cls._results[task_id] = {"status": "failed", "error": str(e)}

        return cls._results[task_id]

    @classmethod
    def _run_bot(cls, task_id: str, bot_method, **kwargs) -> dict:
        """Internal: run a bot and return its result dict."""
        cls._results[task_id] = {"status": "running", "task_type": bot_method.__name__}
        try:
            result = bot_method(**kwargs)
            result["status"] = "completed"
            return result
        except Exception as e:
            logger.exception(f"Bot {bot_method.__name__} failed")
            return {"status": "failed", "error": str(e), "task_type": bot_method.__name__}

    # ── Batch tracking ──────────────────────────────────────

    @classmethod
    def create_batch(cls, files: list[dict]) -> str:
        """Create a batch analysis and return batch ID."""
        batch_id = str(uuid.uuid4())
        cls._batch_progress[batch_id] = {
            "batch_id": batch_id,
            "status": "running",
            "total": len(files),
            "completed": 0,
            "failed": 0,
            "task_ids": [],
            "results": [],
        }
        return batch_id

    @classmethod
    def get_batch_status(cls, batch_id: str) -> dict:
        """Get status of a batch analysis."""
        batch = cls._batch_progress.get(batch_id)
        if batch is None:
            return {"status": "not_found", "error": f"No batch found with id {batch_id}"}
        return batch

    # ── Bot 1: Prediction ────────────────────────────────────

    @staticmethod
    def bot_predict(image_data: bytes, filename: str = "") -> dict:
        """Run the Aria model prediction on image bytes."""
        image = load_image_from_bytes(image_data, filename)
        result = get_prediction(image)
        return result

    # ── Bot 2: Heatmap + Elevation + Suspicious Regions ──────

    @staticmethod
    def bot_heatmap(image_data: bytes, filename: str = "") -> dict:
        """Generate Grad-CAM heatmap, elevation map, and suspicious regions."""
        image = load_image_from_bytes(image_data, filename)
        heatmap_b64 = generate_heatmap(image)

        elevation_map = None
        suspicious_regions = None

        if model is not None and heatmap_b64 is not None:
            try:
                input_tensor = transform(image).unsqueeze(0).to(DEVICE)
                import torch

                with torch.no_grad():
                    outputs = model(input_tensor)
                    pred = outputs.argmax(dim=1).item()

                cam = model.get_heatmap(input_tensor, class_idx=pred)
                if cam is not None:
                    from scipy.ndimage import zoom, label, center_of_mass

                    h, w = cam.shape
                    factor = 28 / max(h, w)
                    cam_small = zoom(cam, (factor, factor))
                    cam_small = cam_small[:28, :28]

                    elev = []
                    for y in range(cam_small.shape[0]):
                        for x in range(cam_small.shape[1]):
                            z = float(cam_small[y, x])
                            if z > 0.05:
                                elev.append({"x": x, "y": y, "z": z})
                    elevation_map = elev

                    # Only flag suspicious regions when prediction is NOT Normal
                    if CLASS_LABELS[pred] != "Normal":
                        binary = (cam > 0.5).astype(int)
                        labeled, num_features = label(binary)
                        regions = []
                        for i in range(1, num_features + 1):
                            mask = labeled == i
                            coords = np.argwhere(mask)
                            if len(coords) < 5:
                                continue
                            center = center_of_mass(mask)
                            intensity = float(cam[mask].mean())
                            area_px = int(mask.sum())
                            scale_y = 224 / cam.shape[0]
                            scale_x = 224 / cam.shape[1]
                            regions.append({
                                "cx": round(center[1] * scale_x, 1),
                                "cy": round(center[0] * scale_y, 1),
                                "intensity": round(intensity, 3),
                                "area_px": area_px,
                            })
                        if regions:
                            suspicious_regions = regions
            except Exception as e:
                logger.warning(f"Heatmap detail generation failed: {e}")

        return {
            "heatmap_b64": heatmap_b64,
            "elevation_map": elevation_map,
            "suspicious_regions": suspicious_regions,
        }

    # ── Bot 3: 3D Volume Data ────────────────────────────────

    @staticmethod
    def bot_3d(image_data: bytes) -> dict:
        """Generate enhanced 3D volume data: elevation_map (28x28), contour_data, volume_stats."""
        image = load_image_from_bytes(image_data, "")
        elevation_map = None
        contour_data = None
        volume_stats = None

        if model is not None:
            try:
                input_tensor = transform(image).unsqueeze(0).to(DEVICE)
                import torch

                with torch.no_grad():
                    outputs = model(input_tensor)
                    pred = outputs.argmax(dim=1).item()

                cam = model.get_heatmap(input_tensor, class_idx=pred)
                if cam is not None:
                    from scipy.ndimage import zoom, label, find_objects

                    h, w = cam.shape
                    factor = 28 / max(h, w)
                    cam_small = zoom(cam, (factor, factor))
                    cam_small = cam_small[:28, :28]

                    elev = []
                    for y in range(cam_small.shape[0]):
                        for x in range(cam_small.shape[1]):
                            z = float(cam_small[y, x])
                            if z > 0.05:
                                elev.append({"x": x, "y": y, "z": z})
                    elevation_map = elev

                    # Contour data (boundary boxes of high-activation areas)
                    binary_high = (cam_small > 0.5).astype(int)
                    contours = []
                    labeled, nf = label(binary_high)
                    for i in range(1, nf + 1):
                        obj_slice = find_objects(labeled == i)
                        if obj_slice:
                            sy, sx = obj_slice[0]
                            contours.append({
                                "y_start": int(sy.start),
                                "y_end": int(sy.stop),
                                "x_start": int(sx.start),
                                "x_end": int(sx.stop),
                                "area_px": int((labeled == i).sum()),
                            })
                    contour_data = contours if contours else []

                    # Volume stats
                    volume_stats = {
                        "mean_activation": float(cam.mean()),
                        "max_activation": float(cam.max()),
                        "std_activation": float(cam.std()),
                        "active_pixels_ratio": round(float((cam > 0.5).sum() / cam.size), 4),
                        "elevation_resolution": f"{cam_small.shape[0]}x{cam_small.shape[1]}",
                    }
            except Exception as e:
                logger.warning(f"3D data generation failed: {e}")

        return {
            "elevation_map": elevation_map,
            "contour_data": contour_data,
            "volume_stats": volume_stats,
        }

    # ── Bot 4: DICOM Metadata Extraction ─────────────────────

    @staticmethod
    def bot_metadata(image_data: bytes, filename: str = "") -> dict:
        """Extract full DICOM metadata including patient demographics, scanner info, study details."""
        metadata = {
            "filename": filename,
            "is_dicom": False,
            "patient": {},
            "scanner": {},
            "study": {},
            "image_info": {},
        }

        # Try DICOM first
        try:
            import pydicom
            ds = pydicom.dcmread(io.BytesIO(image_data), force=True)

            if hasattr(ds, 'SOPClassUID'):
                metadata["is_dicom"] = True

                metadata["patient"] = {
                    "patient_name": str(getattr(ds, 'PatientName', '—')),
                    "patient_id": str(getattr(ds, 'PatientID', '—')),
                    "patient_age": str(getattr(ds, 'PatientAge', '—')),
                    "patient_sex": str(getattr(ds, 'PatientSex', '—')),
                    "patient_birth_date": str(getattr(ds, 'PatientBirthDate', '—')),
                    "patient_weight": str(getattr(ds, 'PatientWeight', '—')),
                }

                metadata["scanner"] = {
                    "modality": str(getattr(ds, 'Modality', '—')),
                    "manufacturer": str(getattr(ds, 'Manufacturer', '—')),
                    "manufacturer_model": str(getattr(ds, 'ManufacturerModelName', '—')),
                    "device_serial": str(getattr(ds, 'DeviceSerialNumber', '—')),
                    "software_version": str(getattr(ds, 'SoftwareVersions', '—')),
                    "institution": str(getattr(ds, 'InstitutionName', '—')),
                    "station_name": str(getattr(ds, 'StationName', '—')),
                }

                metadata["study"] = {
                    "study_date": str(getattr(ds, 'StudyDate', '—')),
                    "study_time": str(getattr(ds, 'StudyTime', '—')),
                    "study_description": str(getattr(ds, 'StudyDescription', '—')),
                    "series_description": str(getattr(ds, 'SeriesDescription', '—')),
                    "accession_number": str(getattr(ds, 'AccessionNumber', '—')),
                    "study_instance_uid": str(getattr(ds, 'StudyInstanceUID', '—')),
                    "referring_physician": str(getattr(ds, 'ReferringPhysicianName', '—')),
                }

                metadata["image_info"] = {
                    "rows": int(getattr(ds, 'Rows', 0)),
                    "columns": int(getattr(ds, 'Columns', 0)),
                    "bits_allocated": int(getattr(ds, 'BitsAllocated', 0)),
                    "pixel_spacing": str(getattr(ds, 'PixelSpacing', '—')),
                    "slice_thickness": str(getattr(ds, 'SliceThickness', '—')),
                    "window_center": str(getattr(ds, 'WindowCenter', '—')),
                    "window_width": str(getattr(ds, 'WindowWidth', '—')),
                }

        except Exception as e:
            logger.debug(f"DICOM metadata extraction failed (non-DICOM file): {e}")

        # Try to get basic image info regardless
        try:
            img = Image.open(io.BytesIO(image_data))
            metadata["image_info"]["format"] = img.format or "Unknown"
            metadata["image_info"]["mode"] = img.mode
            metadata["image_info"]["size"] = f"{img.size[0]}x{img.size[1]}"
        except Exception:
            pass

        return metadata

    # ── Bot 5: DeepSeek Clinical Report ──────────────────────

    @staticmethod
    def bot_report(analysis: dict, patient: dict, smoking_history: str | None = None, clinical_indication: str | None = None) -> dict:
        """Use DeepSeek to generate an intelligent clinical report."""
        client = DeepSeekClient()
        report = client.generate_report(analysis, patient, smoking_history=smoking_history, clinical_indication=clinical_indication)
        return report

    # ── Bot 6: Google Drive Streaming via rclone ────────────

    @staticmethod
    def bot_drive(path: str) -> dict:
        """Stream a file from Google Drive via rclone. Returns file data + metadata."""
        try:
            result = subprocess.run(
                ["rclone", "cat", path],
                capture_output=True,
                timeout=120,
            )
            if result.returncode != 0:
                stderr = result.stderr.decode("utf-8", errors="replace")
                return {
                    "status": "failed",
                    "error": f"rclone failed: {stderr}",
                }

            file_data = result.stdout
            file_size = len(file_data)

            # Get metadata via rclone lsjson
            meta_result = subprocess.run(
                ["rclone", "lsjson", path],
                capture_output=True,
                timeout=30,
            )
            metadata = {}
            if meta_result.returncode == 0:
                try:
                    meta_json = json.loads(meta_result.stdout)
                    if isinstance(meta_json, list) and meta_json:
                        metadata = meta_json[0]
                    elif isinstance(meta_json, dict):
                        metadata = meta_json
                except json.JSONDecodeError:
                    pass

            return {
                "status": "completed",
                "file_data_b64": base64.b64encode(file_data).decode("utf-8"),
                "file_size": file_size,
                "metadata": metadata,
            }
        except subprocess.TimeoutExpired:
            return {"status": "failed", "error": "rclone timed out after 120 seconds"}
        except FileNotFoundError:
            return {"status": "failed", "error": "rclone not found on system PATH. Install rclone first."}
        except Exception as e:
            return {"status": "failed", "error": str(e)}

    # ── Bot 7: Compare Multiple Analyses ─────────────────────

    @staticmethod
    def bot_compare(analyses: list) -> dict:
        """Compare multiple analyses and return trend data, changes, delta stats."""
        if not analyses:
            return {
                "status": "failed",
                "error": "No analyses provided for comparison",
            }

        predictions = [a.get("prediction", "Unknown") for a in analyses]
        confidences = [a.get("confidence_pct", 0) for a in analyses]
        risk_levels = [a.get("risk_level", "Unknown") for a in analyses]

        # Simple trend detection
        trend = "stable"
        if len(confidences) >= 2:
            if confidences[-1] > confidences[0] * 1.1:
                trend = "increasing_confidence"
            elif confidences[-1] < confidences[0] * 0.9:
                trend = "decreasing_confidence"

        # Count changes in prediction
        unique_preds = set(predictions)
        prediction_changed = len(unique_preds) > 1

        deltas = []
        for i in range(1, len(analyses)):
            deltas.append({
                "from_index": i - 1,
                "to_index": i,
                "confidence_delta": round(confidences[i] - confidences[i - 1], 2),
                "risk_level_from": risk_levels[i - 1],
                "risk_level_to": risk_levels[i],
            })

        return {
            "status": "completed",
            "num_analyses": len(analyses),
            "predictions": predictions,
            "confidences": confidences,
            "risk_levels": risk_levels,
            "trend": trend,
            "prediction_changed": prediction_changed,
            "deltas": deltas,
            "summary": {
                "mean_confidence": round(float(np.mean(confidences)), 2) if confidences else 0,
                "min_confidence": round(float(np.min(confidences)), 2) if confidences else 0,
                "max_confidence": round(float(np.max(confidences)), 2) if confidences else 0,
                "most_common_prediction": max(set(predictions), key=predictions.count) if predictions else "Unknown",
            },
        }

    # ── Bot 8: Export for PDF/Print ──────────────────────────

    @staticmethod
    def bot_export(analysis: dict, patient: dict, report: dict) -> dict:
        """Generate structured export data suitable for PDF/print rendering."""
        export = {
            "status": "completed",
            "export_type": "clinical_report",
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "patient_info": {
                "name": patient.get("patient_name", "—"),
                "age": patient.get("patient_age", "—"),
                "sex": patient.get("patient_sex", "—"),
                "modality": patient.get("modality", "—"),
                "study_date": patient.get("study_date", "—"),
            },
            "ai_analysis": {
                "prediction": analysis.get("prediction", "—"),
                "confidence_pct": analysis.get("confidence_pct", 0),
                "risk_level": analysis.get("risk_level", "—"),
                "recommendation": analysis.get("recommendation", "—"),
                "all_scores": analysis.get("all_scores", []),
            },
            "clinical_report": {
                "narrative_summary": report.get("narrative_summary", ""),
                "risk_factors": report.get("risk_factors", []),
                "followup_recommendations": report.get("followup_recommendations", []),
                "confidence_assessment": report.get("confidence_assessment", ""),
                "patient_context": report.get("patient_context", ""),
            },
            "metadata": {
                "model": "ResNet-18 (Aria v2.5.0)",
                "report_engine": "DeepSeek v4 Flash",
                "classes": CLASS_LABELS,
            },
        }
        return export

    # ── Bot 9: Batch Analysis ───────────────────────────────

    @staticmethod
    def bot_batch(files: list) -> dict:
        """Run batch analysis on multiple files and aggregate results."""
        if not files:
            return {"status": "failed", "error": "No files provided for batch analysis"}

        results = []
        for item in files:
            try:
                image_data_b64 = item.get("image_data", "")
                filename = item.get("filename", "unknown")
                image_data = base64.b64decode(image_data_b64)

                image = load_image_from_bytes(image_data, filename)
                pred = get_prediction(image)
                pred["filename"] = filename
                pred["status"] = "completed"
                results.append(pred)
            except Exception as e:
                results.append({
                    "filename": item.get("filename", "unknown"),
                    "status": "failed",
                    "error": str(e),
                })

        completed_results = [r for r in results if r.get("status") == "completed"]
        failed_results = [r for r in results if r.get("status") == "failed"]

        predictions = [r.get("prediction", "Unknown") for r in completed_results]

        return {
            "status": "completed",
            "total": len(files),
            "completed": len(completed_results),
            "failed": len(failed_results),
            "results": results,
            "summary": {
                "total": len(files),
                "completed": len(completed_results),
                "failed": len(failed_results),
                "predictions": predictions,
                "prediction_counts": {
                    label: predictions.count(label) for label in set(predictions)
                },
            },
        }

    # ── Bot 10: Health / System Status ──────────────────────

    @classmethod
    def bot_health(cls) -> dict:
        """Return system status, model loaded, uptime, queue size, worker count."""
        uptime_seconds = time.time() - cls._start_time
        pending = sum(
            1 for r in cls._results.values() if r.get("status") == "pending"
        )
        running = sum(
            1 for r in cls._results.values() if r.get("status") == "running"
        )
        completed = sum(
            1 for r in cls._results.values() if r.get("status") == "completed"
        )
        failed = sum(
            1 for r in cls._results.values() if r.get("status") == "failed"
        )

        active_workers = 0
        if cls._futures:
            active_workers = len([f for f in cls._futures.values() if not f.done()])

        max_workers = 4
        if hasattr(cls._executor, '_max_workers'):
            max_workers = cls._executor._max_workers

        return {
            "status": "healthy",
            "service": "Aria Orchestrator",
            "version": "1.0.0",
            "model_loaded": model is not None,
            "device": str(DEVICE),
            "classes": CLASS_LABELS,
            "uptime_seconds": round(uptime_seconds, 1),
            "uptime_formatted": time.strftime(
                "%H:%M:%S", time.gmtime(uptime_seconds)
            ),
            "queue": {
                "total_tasks": len(cls._results),
                "pending": pending,
                "running": running,
                "completed": completed,
                "failed": failed,
            },
            "workers": {
                "max_workers": max_workers,
                "active_workers": active_workers,
            },
        }

    # ── Audit Trail ──────────────────────────────────────────

    @classmethod
    def get_audit_log(cls) -> list[dict]:
        """Return the full audit log of all analyses performed."""
        return list(cls._audit_log)

    @classmethod
    def get_audit_stats(cls) -> dict:
        """Return department analytics: total analyzed, risk distribution, avg confidence, avg processing time."""
        total = len(cls._audit_log)
        if total == 0:
            return {
                "total_analyzed": 0,
                "risk_distribution": {},
                "avg_confidence_pct": 0.0,
                "avg_processing_time_ms": 0.0,
                "prediction_distribution": {},
            }

        risk_dist: dict[str, int] = {}
        pred_dist: dict[str, int] = {}
        total_conf = 0.0
        total_time = 0.0
        time_count = 0

        for entry in cls._audit_log:
            risk = entry.get("risk_level", "Unknown")
            risk_dist[risk] = risk_dist.get(risk, 0) + 1
            pred = entry.get("prediction", "Unknown")
            pred_dist[pred] = pred_dist.get(pred, 0) + 1
            total_conf += entry.get("confidence_pct", 0)
            proc_time = entry.get("processing_time_ms")
            if proc_time is not None:
                total_time += proc_time
                time_count += 1

        return {
            "total_analyzed": total,
            "risk_distribution": risk_dist,
            "prediction_distribution": pred_dist,
            "avg_confidence_pct": round(total_conf / total, 2) if total > 0 else 0.0,
            "avg_processing_time_ms": round(total_time / time_count, 2) if time_count > 0 else 0.0,
        }

    # ── Prior Comparison ─────────────────────────────────────

    @staticmethod
    def compare_with_prior(prior_analysis: dict, current_analysis: dict) -> dict:
        """Compare a prior analysis with the current one and return changes.

        Returns:
            dict with: changes_in_size, changes_in_confidence, new_regions,
                       resolved_regions, growth_rate, prediction_change
        """
        prior_pred = prior_analysis.get("prediction", "Unknown")
        current_pred = current_analysis.get("prediction", "Unknown")
        prior_conf = prior_analysis.get("confidence_pct", 0)
        current_conf = current_analysis.get("confidence_pct", 0)

        prior_size = prior_analysis.get("lesion_size_mm")
        current_size = current_analysis.get("lesion_size_mm")

        prior_regions = prior_analysis.get("suspicious_regions", []) or []
        current_regions = current_analysis.get("suspicious_regions", []) or []

        # Changes in size
        changes_in_size = None
        growth_rate = None
        if prior_size is not None and current_size is not None:
            diff = round(current_size - prior_size, 2)
            changes_in_size = diff
            if prior_size > 0:
                growth_rate = round(((current_size - prior_size) / prior_size) * 100, 2)

        # Changes in confidence
        changes_in_confidence = round(current_conf - prior_conf, 2)

        # Detect new and resolved regions by approximate position matching
        def _region_key(r):
            return (round(r.get("cx", 0), 0), round(r.get("cy", 0), 0))

        prior_keys = {_region_key(r) for r in prior_regions}
        current_keys = {_region_key(r) for r in current_regions}

        new_regions = [r for r in current_regions if _region_key(r) not in prior_keys]
        resolved_regions = [r for r in prior_regions if _region_key(r) not in current_keys]

        return {
            "changes_in_size_mm": changes_in_size,
            "changes_in_confidence_pct": changes_in_confidence,
            "new_regions": new_regions,
            "resolved_regions": resolved_regions,
            "growth_rate_pct": growth_rate,
            "prediction_change": prior_pred != current_pred,
            "prior_prediction": prior_pred,
            "current_prediction": current_pred,
        }

    # ── Full analysis convenience ────────────────────────────

    @classmethod
    def run_full_analysis(cls, image_data: bytes, filename: str = "", patient: dict | None = None) -> dict:
        """Run all analysis bots in parallel and return combined result."""
        _analysis_start = time.time()

        # Submit all analysis tasks
        predict_id = cls.submit_task("predict", image_data=image_data, filename=filename)
        heatmap_id = cls.submit_task("heatmap", image_data=image_data, filename=filename)
        threed_id = cls.submit_task("3d", image_data=image_data)
        metadata_id = cls.submit_task("metadata", image_data=image_data, filename=filename)

        # Wait for results (poll until all done)
        task_ids = [predict_id, heatmap_id, threed_id, metadata_id]
        for tid in task_ids:
            while True:
                r = cls.get_result(tid)
                if r.get("status") in ("completed", "failed"):
                    break
                time.sleep(0.05)

        predict_result = cls.get_result(predict_id)
        heatmap_result = cls.get_result(heatmap_id)
        threed_result = cls.get_result(threed_id)
        metadata_result = cls.get_result(metadata_id)

        # Build patient info from metadata if not provided
        if patient is None:
            m = metadata_result if isinstance(metadata_result, dict) else {}
            patient_info = m.get("patient", {}) if isinstance(m, dict) else {}
            scanner_info = m.get("scanner", {}) if isinstance(m, dict) else {}
            study_info = m.get("study", {}) if isinstance(m, dict) else {}
            patient_data = {
                "patient_name": patient_info.get("patient_name", "Unknown"),
                "patient_age": patient_info.get("patient_age", "Unknown"),
                "patient_sex": patient_info.get("patient_sex", "Unknown"),
                "modality": scanner_info.get("modality", "Unknown"),
                "study_date": study_info.get("study_date", "Unknown"),
            }
        else:
            patient_data = patient

        # Extract optional clinical context from patient dict
        smoking_history = patient_data.get("smoking_history") if isinstance(patient_data, dict) else None
        clinical_indication = patient_data.get("clinical_indication") if isinstance(patient_data, dict) else None

        # Assemble combined result (flat structure matching Analyze3DResult)
        combined = {}

        # Generate image preview from original bytes (for 2D view)
        try:
            img = load_image_from_bytes(image_data, filename)
            import io as _io
            import base64 as _b64
            buf = _io.BytesIO()
            img.save(buf, format='JPEG', quality=85)
            combined["image_preview"] = f"data:image/jpeg;base64,{_b64.b64encode(buf.getvalue()).decode()}"
        except Exception:
            combined["image_preview"] = None

        # Prediction fields
        if predict_result.get("status") == "completed":
            combined.update({
                "prediction": predict_result.get("prediction", "Unknown"),
                "confidence": predict_result.get("confidence", 0),
                "confidence_pct": predict_result.get("confidence_pct", 0),
                "risk_level": predict_result.get("risk_level", "None"),
                "recommendation": predict_result.get("recommendation", ""),
                "all_scores": predict_result.get("all_scores", []),
            })

        # Uncertainty warning based on confidence
        confidence_pct_val = combined.get("confidence_pct", 0)
        if confidence_pct_val < 40:
            combined["uncertainty_warning"] = True
            combined["uncertainty_reason"] = "Low confidence — clinical correlation strongly advised"
        elif confidence_pct_val < 65:
            combined["uncertainty_warning"] = True
            combined["uncertainty_reason"] = "Borderline confidence — consider second review"

        # Heatmap / elevation
        if heatmap_result.get("status") == "completed":
            if heatmap_result.get("heatmap_b64"):
                combined["heatmap"] = heatmap_result["heatmap_b64"]
            elev = heatmap_result.get("elevation_map")
            if elev:
                # Convert from [{x,y,z}] to [[x,y,z]] format
                if isinstance(elev, list) and len(elev) > 0 and isinstance(elev[0], dict):
                    elev_arr = [[p["x"], p["y"], p["z"]] for p in elev]
                else:
                    elev_arr = elev
                combined["elevation_map"] = elev_arr  # raw list — FastAPI will serialize
            regions = heatmap_result.get("suspicious_regions")
            prediction = combined.get("prediction", "Unknown")
            if regions and prediction != "Normal":
                # Map area_px to area for the dashboard
                for r in regions:
                    if "area_px" in r and "area" not in r:
                        r["area"] = r["area_px"]
                combined["suspicious_regions"] = regions

                # ── Lesion size estimation (assume 0.5mm per pixel for standard CT) ──
                PIXEL_SPACING_MM = 0.5
                total_area_px = sum(r.get("area_px", 0) for r in regions)
                total_area_mm2 = total_area_px * (PIXEL_SPACING_MM ** 2)
                if total_area_mm2 > 0:
                    lesion_size_mm = round(math.sqrt(4 * total_area_mm2 / math.pi), 2)
                    lesion_volume_mm3 = round(total_area_mm2 * PIXEL_SPACING_MM, 2)  # approx volume (area * slice thickness)
                else:
                    lesion_size_mm = 0.0
                    lesion_volume_mm3 = 0.0
                combined["lesion_size_mm"] = lesion_size_mm
                combined["lesion_volume_mm3"] = lesion_volume_mm3

            # Explicitly remove suspicious_regions for Normal predictions
            if prediction == "Normal":
                combined.pop("suspicious_regions", None)

        # 3D contour data
        if threed_result.get("status") == "completed":
            if not combined.get("elevation_map"):
                elev3d = threed_result.get("elevation_map")
                if elev3d:
                    # Convert from [{x,y,z}] to [[x,y,z]] format
                    if isinstance(elev3d, list) and len(elev3d) > 0 and isinstance(elev3d[0], dict):
                        elev_arr = [[p["x"], p["y"], p["z"]] for p in elev3d]
                    else:
                        elev_arr = elev3d
                    combined["elevation_map"] = elev_arr  # raw list — FastAPI will serialize

        # Metadata
        if metadata_result.get("status") == "completed":
            combined["scanner_info"] = {
                "modality": metadata_result.get("scanner", {}).get("modality", "\u2014"),
                "manufacturer": metadata_result.get("scanner", {}).get("manufacturer", "\u2014"),
                "study_date": metadata_result.get("study", {}).get("study_date", "\u2014"),
            }

        # Generate report with full analysis context (including regions + lesion size)
        report_analysis = dict(combined)  # copy so report has all assembled fields
        report_id = cls.submit_task(
            "report",
            analysis=report_analysis,
            patient=patient_data,
            smoking_history=smoking_history,
            clinical_indication=clinical_indication,
        )
        while True:
            r = cls.get_result(report_id)
            if r.get("status") in ("completed", "failed"):
                break
            time.sleep(0.05)
        report_result = cls.get_result(report_id)

        # Clinical report
        if report_result.get("status") == "completed":
            report_data = report_result.get("result", report_result)
            if isinstance(report_data, dict) and not report_data.get("error"):
                # Extract report fields including new ones
                report = {}
                for key in [
                    "narrative_summary", "risk_factors", "followup_recommendations",
                    "confidence_assessment", "patient_context",
                    "differential_diagnoses", "fleischner_class",
                ]:
                    if key in report_data:
                        report[key] = report_data[key]
                if report:
                    combined["clinical_report"] = report

        # ── Audit log entry ──
        processing_time_ms = round((time.time() - _analysis_start) * 1000, 2)
        audit_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "patient_name": patient_data.get("patient_name", "Unknown"),
            "patient_age": patient_data.get("patient_age", "Unknown"),
            "filename": filename,
            "prediction": combined.get("prediction", "Unknown"),
            "confidence_pct": combined.get("confidence_pct", 0),
            "risk_level": combined.get("risk_level", "Unknown"),
            "processing_time_ms": processing_time_ms,
        }
        cls._audit_log.append(audit_entry)

        return combined


# ────────────────────────────────────────────────────────────
# FastAPI Route Registration
# ────────────────────────────────────────────────────────────

def register_routes(app):
    """Register all Aria Orchestrator routes on a FastAPI app."""
    from fastapi import File, UploadFile, HTTPException
    from pydantic import BaseModel
    from typing import Optional

    # ── Pydantic models ───────────────────────────────────

    class ReportRequest(BaseModel):
        analysis: dict
        patient: dict

    # ── Endpoints ─────────────────────────────────────────

    @app.post("/api/aria/full_analysis")
    async def full_analysis(file: UploadFile = File(...)):
        """Submit all analysis tasks in parallel and return combined result."""
        if not aria_main.is_supported(file):
            raise HTTPException(400, "Only image and DICOM files are supported")

        contents = await file.read()
        result = AriaOrchestrator.run_full_analysis(contents, file.filename or "")
        return result

    @app.post("/api/aria/batch_analysis")
    async def batch_analysis(files: list[UploadFile] = File(...)):
        """Run full analysis pipeline on multiple files and return results as a JSON array."""
        if not files:
            raise HTTPException(400, "No files provided")

        results = []
        for f in files:
            try:
                if not aria_main.is_supported(f):
                    results.append({
                        "filename": f.filename or "unknown",
                        "status": "failed",
                        "error": "Unsupported file type — only images and DICOM files are accepted",
                    })
                    continue
                contents = await f.read()
                result = AriaOrchestrator.run_full_analysis(contents, f.filename or "")
                result["filename"] = f.filename or "unknown"
                result["status"] = "completed"
                results.append(result)
            except Exception as e:
                results.append({
                    "filename": f.filename or "unknown",
                    "status": "failed",
                    "error": str(e),
                })

        return results

    @app.post("/api/aria/batch_analyze")
    async def batch_analyze(files: list[UploadFile] = File(...)):
        """Batch analysis of multiple files."""
        if not files:
            raise HTTPException(400, "No files provided")

        # Create batch
        batch_id = AriaOrchestrator.create_batch(
            [{"filename": f.filename or "unknown"} for f in files]
        )

        # Submit each file as a prediction task
        for f in files:
            contents = await f.read()
            task_id = AriaOrchestrator.submit_task(
                "predict", image_data=contents, filename=f.filename or ""
            )
            AriaOrchestrator._batch_progress[batch_id]["task_ids"].append(task_id)

        # Start a background thread to monitor and update batch progress
        def monitor_batch(bid, tids):
            while True:
                completed_count = 0
                failed_count = 0
                for tid in tids:
                    r = AriaOrchestrator.get_result(tid)
                    if r.get("status") == "completed":
                        completed_count += 1
                    elif r.get("status") == "failed":
                        failed_count += 1

                batch = AriaOrchestrator._batch_progress.get(bid)
                if batch:
                    batch["completed"] = completed_count
                    batch["failed"] = failed_count

                if completed_count + failed_count >= len(tids):
                    batch = AriaOrchestrator._batch_progress.get(bid)
                    if batch:
                        batch["status"] = "completed"
                        results = []
                        for tid in tids:
                            results.append(AriaOrchestrator.get_result(tid))
                        batch["results"] = results
                        completed_results = [r for r in results if r.get("status") == "completed"]
                        predictions = [r.get("prediction", "Unknown") for r in completed_results]
                        batch["summary"] = {
                            "total": len(tids),
                            "completed": len(completed_results),
                            "failed": len(results) - len(completed_results),
                            "predictions": predictions,
                        }
                    break
                time.sleep(0.5)

        t = threading.Thread(
            target=monitor_batch,
            args=(batch_id, AriaOrchestrator._batch_progress[batch_id]["task_ids"]),
            daemon=True,
        )
        t.start()

        return {
            "status": "running",
            "batch_id": batch_id,
            "message": f"Batch analysis started for {len(files)} files.",
        }

    @app.get("/api/aria/batch_status/{batch_id}")
    async def batch_status(batch_id: str):
        """Check batch progress."""
        return AriaOrchestrator.get_batch_status(batch_id)

    @app.post("/api/aria/report")
    async def generate_report(request: ReportRequest):
        """Generate a DeepSeek clinical report for an existing analysis."""
        analysis = request.analysis
        patient = request.patient
        task_id = AriaOrchestrator.submit_task("report", analysis=analysis, patient=patient)

        # Wait for result
        while True:
            r = AriaOrchestrator.get_result(task_id)
            if r.get("status") in ("completed", "failed"):
                break
            time.sleep(0.05)

        if r.get("status") == "failed":
            raise HTTPException(
                500, f"Report generation failed: {r.get('error', 'Unknown error')}"
            )

        return {
            "status": "completed",
            "narrative_summary": r.get("narrative_summary", ""),
            "risk_factors": r.get("risk_factors", []),
            "followup_recommendations": r.get("followup_recommendations", []),
            "confidence_assessment": r.get("confidence_assessment", ""),
            "patient_context": r.get("patient_context", ""),
        }

    @app.get("/api/aria/orchestrator/status")
    async def orchestrator_status():
        """Orchestrator health and queue status."""
        return AriaOrchestrator.bot_health()
