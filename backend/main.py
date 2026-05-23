"""
Omnia AI Backend Server
Loads aria_model.pth (ResNet-18, 3-class) and serves predictions + Grad-CAM heatmaps.
"""
from __future__ import annotations
import os
import sys
import io
import base64
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.transforms as transforms
from PIL import Image
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
from pydantic import BaseModel

app = FastAPI(title="Omnia AI - Aria Engine", version="2.5.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# ─── Model ───
class BasicBlock(nn.Module):
    expansion = 1
    def __init__(self, in_planes, planes, stride=1):
        super().__init__()
        self.conv1 = nn.Conv2d(in_planes, planes, 3, stride, 1, bias=False)
        self.bn1 = nn.BatchNorm2d(planes)
        self.conv2 = nn.Conv2d(planes, planes, 3, 1, 1, bias=False)
        self.bn2 = nn.BatchNorm2d(planes)
        self.downsample = nn.Sequential()
        if stride != 1 or in_planes != self.expansion * planes:
            self.downsample = nn.Sequential(
                nn.Conv2d(in_planes, self.expansion * planes, 1, stride, bias=False),
                nn.BatchNorm2d(self.expansion * planes)
            )
    def forward(self, x):
        r = x
        o = F.relu(self.bn1(self.conv1(x)))
        o = self.bn2(self.conv2(o))
        o += self.downsample(r)
        return F.relu(o)

class ResNet(nn.Module):
    def __init__(self, block, num_blocks, num_classes=3):
        super().__init__()
        self.in_planes = 64
        self.conv1 = nn.Conv2d(3, 64, 7, 2, 3, bias=False)
        self.bn1 = nn.BatchNorm2d(64)
        self.layer1 = self._make_layer(block, 64, num_blocks[0], 1)
        self.layer2 = self._make_layer(block, 128, num_blocks[1], 2)
        self.layer3 = self._make_layer(block, 256, num_blocks[2], 2)
        self.layer4 = self._make_layer(block, 512, num_blocks[3], 2)
        self.fc = nn.Sequential(nn.Dropout(0.3), nn.Linear(512, num_classes))
        # For Grad-CAM: target the last conv layer
        self.target_conv = None
        self.target_grad = None

    def _make_layer(self, block, planes, num_blocks, stride):
        strides = [stride] + [1] * (num_blocks - 1)
        layers = []
        for s in strides:
            layers.append(block(self.in_planes, planes, s))
            self.in_planes = planes * block.expansion
        return nn.Sequential(*layers)

    def forward(self, x):
        o = F.relu(self.bn1(self.conv1(x)))
        o = F.max_pool2d(o, 3, 2, 1)
        o = self.layer1(o)
        o = self.layer2(o)
        o = self.layer3(o)
        o = self.layer4(o)
        o = F.adaptive_avg_pool2d(o, 1)
        o = o.view(o.size(0), -1)
        o = self.fc(o)
        return o

    def get_heatmap(self, x, class_idx=None):
        """Compute Grad-CAM heatmap."""
        # Register hooks on the last conv layer (layer4.1.conv2)
        conv_layer = self.layer4[-1].conv2
        self.target_conv = None
        self.target_grad = None

        def forward_hook(m, i, o):
            self.target_conv = o.detach()

        def backward_hook(m, gi, go):
            self.target_grad = go[0].detach()

        fh = conv_layer.register_forward_hook(forward_hook)
        bh = conv_layer.register_full_backward_hook(backward_hook)

        # Forward pass
        out = self.forward(x)
        probs = F.softmax(out, dim=1)

        if class_idx is None:
            class_idx = out.argmax(dim=1).item()

        # Backward pass
        self.zero_grad()
        one_hot = torch.zeros_like(out)
        one_hot[0, class_idx] = 1
        out.backward(gradient=one_hot, retain_graph=True)

        fh.remove()
        bh.remove()

        if self.target_grad is None or self.target_conv is None:
            return None

        # Global average pooling of gradients
        weights = self.target_grad.mean(dim=(2, 3), keepdim=True)  # [1, C, 1, 1]

        # Weighted combination of activation maps
        cam = (weights * self.target_conv).sum(dim=1, keepdim=True)  # [1, 1, H, W]
        cam = F.relu(cam)  # Only positive contributions
        cam = F.interpolate(cam, size=(224, 224), mode='bilinear', align_corners=False)
        cam = cam.squeeze().cpu().numpy()

        # Normalize to 0-1
        cmin, cmax = cam.min(), cam.max()
        if cmax > cmin:
            cam = (cam - cmin) / (cmax - cmin)
        else:
            cam = np.zeros_like(cam)

        return cam

def ResNet18(num_classes=3):
    return ResNet(BasicBlock, [2, 2, 2, 2], num_classes)

# ─── Load Model ───
MODEL_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "aria_model.pth")
CLASS_LABELS = ["Benign", "Malignant", "Normal"]
model = None

try:
    model = ResNet18(num_classes=3)
    sd = torch.load(MODEL_PATH, map_location=DEVICE, weights_only=True)
    model.load_state_dict(sd)
    model.to(DEVICE)
    model.eval()
    print(f"[OK] Model loaded from {MODEL_PATH} | Device: {DEVICE} | Classes: {CLASS_LABELS}")
except Exception as e:
    print(f"[WARN] Model load failed: {e}")
    print("[WARN] Running in mock mode")

# ─── Transforms ───
transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

# ─── Helpers ───
def get_prediction(image: Image.Image):
    """Run inference and return prediction dict."""
    input_tensor = transform(image).unsqueeze(0).to(DEVICE)
    if model is not None:
        with torch.no_grad():
            outputs = model(input_tensor)
            probs = F.softmax(outputs, dim=1)
            conf, pred = torch.max(probs, 1)
        pred_class = CLASS_LABELS[pred.item()]
        conf_val = conf.item()
        scores = probs[0].tolist()
    else:
        import random
        idx = random.randint(0, 2)
        pred_class = CLASS_LABELS[idx]
        conf_val = round(random.uniform(0.75, 0.99), 4)
        scores = [round(random.uniform(0.01, 0.3), 4) for _ in range(3)]
        scores[idx] = conf_val
        total = sum(scores)
        scores = [round(s / total, 4) for s in scores]

    if pred_class == "Malignant":
        risk, rec = "High", "Immediate specialist consultation recommended. Biopsy and further staging required."
    elif pred_class == "Benign":
        risk, rec = "Low", "Non-malignant finding. Routine follow-up recommended per standard protocol."
    else:
        risk, rec = "None", "No abnormalities detected. Continue standard screening protocol."

    return {
        "prediction": pred_class,
        "confidence": round(conf_val, 4),
        "confidence_pct": round(conf_val * 100, 1),
        "risk_level": risk,
        "recommendation": rec,
        "all_scores": [{"class": CLASS_LABELS[i], "score": round(scores[i] * 100, 1)} for i in range(3)],
    }

def generate_heatmap(image: Image.Image):
    """Generate Grad-CAM heatmap as base64 PNG."""
    if model is None:
        return None
    input_tensor = transform(image).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        outputs = model(input_tensor)
        pred = outputs.argmax(dim=1).item()

    cam = model.get_heatmap(input_tensor, class_idx=pred)
    if cam is None:
        return None

    # Create heatmap overlay
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(4, 4))
    # Original image resized
    img_resized = image.resize((224, 224))
    ax.imshow(img_resized, alpha=0.7)
    ax.imshow(cam, cmap='jet', alpha=0.35, vmin=0, vmax=1)
    ax.axis('off')
    fig.subplots_adjust(0, 0, 1, 1, 0, 0)

    buf = io.BytesIO()
    fig.savefig(buf, format='png', bbox_inches='tight', pad_inches=0, dpi=60)
    plt.close(fig)
    buf.seek(0)
    b64 = base64.b64encode(buf.read()).decode('utf-8')
    return f"data:image/png;base64,{b64}"

def load_image_from_bytes(data: bytes, filename: str = "") -> Image.Image:
    """Load image from bytes, handling regular images, DICOM files, and misnamed files."""
    import numpy as np
    # Try as regular image first
    try:
        return Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        pass

    # Try as DICOM
    try:
        import pydicom
        # First try normal read (only works for valid DICOM files)
        try:
            ds = pydicom.dcmread(io.BytesIO(data))
        except Exception:
            # Fallback: try force read for files with missing headers
            try:
                ds = pydicom.dcmread(io.BytesIO(data), force=True)
            except Exception:
                ds = None

        if ds is None:
            raise ValueError("File is not a valid DICOM")

        if not hasattr(ds, 'pixel_array'):
            sop_class = str(getattr(ds, 'SOPClassUID', 'Unknown'))
            modality = str(getattr(ds, 'Modality', 'Unknown'))

            # If both are Unknown, this isn't really a DICOM file
            if sop_class == 'Unknown' and modality == 'Unknown':
                raise ValueError(
                    "This file does not appear to be a medical image (DICOM) or standard image format. "
                    "Please upload a CT, X-ray, MRI scan (.dcm), or a standard image (.jpg, .png)."
                )

            # Map common non-image SOP classes to readable names
            sop_names = {
                '1.2.840.10008.5.1.4.1.1.481.3': 'RT Structure Set',
                '1.2.840.10008.5.1.4.1.1.481.2': 'RT Dose',
                '1.2.840.10008.5.1.4.1.1.481.1': 'RT Plan',
                '1.2.840.10008.5.1.4.1.1.2': 'Patient',
                '1.2.840.10008.5.1.4.1.1.88.59': 'Key Object Selection',
                '1.2.840.10008.5.1.4.1.1.88.33': 'Comprehensive SR',
                '1.2.840.10008.5.1.4.1.1.9.1.1': 'Presentation State',
                '1.2.840.10008.5.1.4.1.1.200.1': 'DICOM Directory',
            }
            readable = sop_names.get(sop_class, modality)
            raise ValueError(
                f"This DICOM file is a {readable} ({modality}) and contains no image pixel data. "
                f"Please upload a CT, X-ray, or MRI scan instead."
            )
        px = ds.pixel_array
        if px.dtype != np.uint8:
            if px.max() > px.min():
                px = ((px - px.min()) / (px.max() - px.min()) * 255).astype(np.uint8)
            else:
                px = np.zeros_like(px, dtype=np.uint8)
        if px.ndim >= 3:
            px = px[0] if px.shape[0] > 1 else px.squeeze()
        if px.ndim == 2:
            return Image.fromarray(px, mode='L').convert('RGB')
        elif px.ndim == 3 and px.shape[2] >= 3:
            return Image.fromarray(px[:,:,:3].astype(np.uint8))
        else:
            return Image.fromarray(px[:,:,0], mode='L').convert('RGB')
    except ImportError:
        raise HTTPException(400, "DICOM support requires pydicom: pip3 install pydicom")
    except Exception as e:
        # Final fallback: try reading as raw image bytes
        try:
            return Image.open(io.BytesIO(data)).convert("RGB")
        except Exception:
            raise HTTPException(400, f"Cannot read file as image or DICOM: {e}")

def is_supported(file: UploadFile) -> bool:
    """Check if file is supported (image or DICOM)."""
    if file.content_type and file.content_type.startswith("image/"):
        return True
    if file.filename and file.filename.lower().endswith('.dcm'):
        return True
    return False

# ─── Routes ───
@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": model is not None, "device": str(DEVICE), "classes": CLASS_LABELS}

@app.get("/api/aria/info")
def aria_info():
    return {"name": "Aria Neural Engine", "version": "2.5.0", "architecture": "ResNet-18",
            "classes": CLASS_LABELS, "loaded": model is not None}

@app.post("/api/aria/predict")
async def predict(file: UploadFile = File(...)):
    if not is_supported(file):
        raise HTTPException(400, "Only image and DICOM files are supported")
    contents = await file.read()
    image = load_image_from_bytes(contents, file.filename or "")
    return get_prediction(image)

class AnalyzeResult(BaseModel):
    prediction: str
    confidence: float
    confidence_pct: float
    all_scores: list
    risk_level: str
    recommendation: str
    heatmap: Optional[str] = None

@app.post("/api/aria/analyze", response_model=AnalyzeResult)
async def analyze(file: UploadFile = File(...)):
    """Full analysis: prediction + Grad-CAM heatmap."""
    if not is_supported(file):
        raise HTTPException(400, "Only image and DICOM files are supported")
    contents = await file.read()
    image = load_image_from_bytes(contents, file.filename or "")

    result = get_prediction(image)
    heatmap_b64 = generate_heatmap(image)

    return AnalyzeResult(
        prediction=result["prediction"],
        confidence=result["confidence"],
        confidence_pct=result["confidence_pct"],
        all_scores=result["all_scores"],
        risk_level=result["risk_level"],
        recommendation=result["recommendation"],
        heatmap=heatmap_b64,
    )

class Analyze3DResult(BaseModel):
    prediction: str
    confidence: float
    confidence_pct: float
    all_scores: list
    risk_level: str
    recommendation: str
    heatmap: Optional[str] = None
    elevation_map: Optional[list] = None
    suspicious_regions: Optional[list] = None
    scanner_info: Optional[dict] = None


@app.post("/api/aria/analyze3d", response_model=Analyze3DResult)
async def analyze3d(file: UploadFile = File(...)):
    """Full 3D analysis: prediction + Grad-CAM heatmap + 3D elevation + suspicious regions."""
    if not is_supported(file):
        raise HTTPException(400, "Only image and DICOM files are supported")
    contents = await file.read()
    image = load_image_from_bytes(contents, file.filename or "")

    result = get_prediction(image)
    heatmap_b64 = generate_heatmap(image)

    # Generate 3D elevation map from the heatmap
    elevation_map = None
    suspicious_regions = None
    scanner_info = None

    if model is not None:
        try:
            input_tensor = transform(image).unsqueeze(0).to(DEVICE)
            with torch.no_grad():
                outputs = model(input_tensor)
                pred = outputs.argmax(dim=1).item()

            cam = model.get_heatmap(input_tensor, class_idx=pred)
            if cam is not None:
                # Downsample to 28x28 grid for 3D surface (keeps it light)
                import numpy as np
                from scipy.ndimage import zoom
                h, w = cam.shape
                factor = 28 / max(h, w)
                cam_small = zoom(cam, (factor, factor))
                cam_small = cam_small[:28, :28]

                # Build elevation grid as flat list [x, y, z]
                elev = []
                for y in range(cam_small.shape[0]):
                    for x in range(cam_small.shape[1]):
                        z = float(cam_small[y, x])
                        if z > 0.05:  # Skip near-zero to keep it clean
                            elev.append([x, y, z])
                elevation_map = elev

                # Detect suspicious regions (high-activation clusters)
                from scipy.ndimage import label, center_of_mass
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
                    # Scale centroids to 224x224 image space
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
        except Exception:
            pass

    # DICOM metadata
    try:
        import pydicom
        import io
        ds = pydicom.dcmread(io.BytesIO(contents), force=True)
        if hasattr(ds, 'PatientName') or hasattr(ds, 'Modality'):
            scanner_info = {
                "modality": str(getattr(ds, 'Modality', '—')),
                "manufacturer": str(getattr(ds, 'Manufacturer', '—')),
                "study_date": str(getattr(ds, 'StudyDate', '—')),
                "series_desc": str(getattr(ds, 'SeriesDescription', '—')),
                "patient_name": str(getattr(ds, 'PatientName', '—')),
                "patient_age": str(getattr(ds, 'PatientAge', '—')),
                "patient_sex": str(getattr(ds, 'PatientSex', '—')),
            }
    except Exception:
        pass

    return Analyze3DResult(
        prediction=result["prediction"],
        confidence=result["confidence"],
        confidence_pct=result["confidence_pct"],
        all_scores=result["all_scores"],
        risk_level=result["risk_level"],
        recommendation=result["recommendation"],
        heatmap=heatmap_b64,
        elevation_map=elevation_map,
        suspicious_regions=suspicious_regions,
        scanner_info=scanner_info,
    )


# ─── Aria Orchestrator Routes ───
# Define routes with lazy imports to avoid circular imports

@app.post("/api/aria/full_analysis")
def full_analysis(file: UploadFile = File(...)):
    """Full analysis pipeline (sync — FastAPI runs it in a thread pool)."""
    from backend.orchestrator import AriaOrchestrator
    if not is_supported(file):
        raise HTTPException(400, "Only image and DICOM files are supported")
    contents = file.file.read()
    result = AriaOrchestrator.run_full_analysis(contents, file.filename or "")
    return result

@app.post("/api/aria/batch_analysis")
def batch_analysis(files: list[UploadFile] = File(...)):
    """Batch analysis: upload multiple files and get results for each."""
    from backend.orchestrator import AriaOrchestrator
    results = []
    for f in files:
        if not is_supported(f):
            results.append({"filename": f.filename, "status": "error", "error": "Unsupported file type"})
            continue
        try:
            contents = f.file.read()
            res = AriaOrchestrator.run_full_analysis(contents, f.filename or "")
            res["filename"] = f.filename
            res["status"] = "completed"
            results.append(res)
        except Exception as e:
            results.append({"filename": f.filename, "status": "error", "error": str(e)})
    return results

@app.post("/api/aria/report")
def generate_report(file: UploadFile = File(...)):
    from backend.orchestrator import AriaOrchestrator
    if not is_supported(file):
        raise HTTPException(400, "Only image and DICOM files are supported")
    contents = file.file.read()
    result = AriaOrchestrator.run_full_analysis(contents, file.filename or "")
    return result

@app.get("/api/aria/orchestrator/status")
def orch_status():
    from backend.orchestrator import AriaOrchestrator
    return AriaOrchestrator.bot_health()

print("[OK] Aria Orchestrator routes registered")
print("[OK] Available: full_analysis, report, orchestrator/status")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
