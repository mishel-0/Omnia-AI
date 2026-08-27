"""Omnia AI — Clinical Trial Pathology PDF Report Generator.
Produces professional PDFs matching clinical pathology report standards.
"""
import os
import io
import datetime
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
)
from reportlab.lib.colors import HexColor

# ─── Color Palette ───
DARK_BLUE = HexColor("#1a365d")
MED_BLUE  = HexColor("#2b6cb0")
LIGHT_BLUE = HexColor("#bee3f8")
DARK_GREEN = HexColor("#22543d")
RED = HexColor("#c53030")
GRAY = HexColor("#4a5568")
LIGHT_GRAY = HexColor("#edf2f7")
BORDER_GRAY = HexColor("#cbd5e0")
WHITE = colors.white
BLACK = colors.black

STYLES = getSampleStyleSheet()

# ─── Custom Styles ───
def _make_styles():
    return {
        "title": ParagraphStyle("ReportTitle", parent=STYLES["Title"],
            fontSize=18, textColor=DARK_BLUE, spaceAfter=2*mm, fontName="Helvetica-Bold"),
        "subtitle": ParagraphStyle("Subtitle", parent=STYLES["Normal"],
            fontSize=9, textColor=GRAY, spaceBefore=0, spaceAfter=4*mm),
        "section_header": ParagraphStyle("SectionHeader", parent=STYLES["Heading2"],
            fontSize=12, textColor=DARK_BLUE, spaceBefore=6*mm, spaceAfter=3*mm,
            fontName="Helvetica-Bold", borderWidth=0, borderPadding=0,
            borderColor=LIGHT_BLUE),
        "label": ParagraphStyle("Label", parent=STYLES["Normal"],
            fontSize=8, textColor=GRAY, fontName="Helvetica"),
        "value": ParagraphStyle("Value", parent=STYLES["Normal"],
            fontSize=10, textColor=BLACK, fontName="Helvetica"),
        "value_bold": ParagraphStyle("ValueBold", parent=STYLES["Normal"],
            fontSize=10, textColor=BLACK, fontName="Helvetica-Bold"),
        "small": ParagraphStyle("Small", parent=STYLES["Normal"],
            fontSize=7, textColor=GRAY, fontName="Helvetica"),
        "footer": ParagraphStyle("Footer", parent=STYLES["Normal"],
            fontSize=7, textColor=GRAY, alignment=TA_CENTER),
        "disclaimer": ParagraphStyle("Disclaimer", parent=STYLES["Normal"],
            fontSize=7, textColor=GRAY, alignment=TA_CENTER,
            borderWidth=0.5, borderColor=BORDER_GRAY, borderPadding=3*mm,
            spaceBefore=5*mm),
        "result_grade": ParagraphStyle("ResultGrade", parent=STYLES["Normal"],
            fontSize=16, textColor=DARK_BLUE, fontName="Helvetica-Bold"),
        "result_value": ParagraphStyle("ResultValue", parent=STYLES["Normal"],
            fontSize=12, textColor=BLACK, fontName="Helvetica"),
        "result_label": ParagraphStyle("ResultLabel", parent=STYLES["Normal"],
            fontSize=8, textColor=GRAY, fontName="Helvetica"),
    }


def generate_pathology_pdf(
    trial_name: str = "",
    sponsor: str = "",
    drug: str = "",
    patient_id: str = "",
    visit: str = "",
    slide_filename: str = "",
    analysis_date: str = "",
    ai_grade: str = "",
    ai_confidence: float = None,
    tumor_size_mm: float = None,
    biomarkers: dict = None,
    treatment_response: str = "",
    prior_size_mm: float = 0.0,
    doctor_correction: str = None,
    notes: str = "",
    output_path: str = None,
    grade_group: int = None,
    risk_group: str = "",
    tumor_involvement_pct: int = None,
    perineural_invasion: bool = None,
    lymphovascular_invasion: bool = None,
    cribriform_pattern: bool = None,
    quality: dict = None,
    regions_analyzed: int = None,
    suspicious_regions: int = None,
    processing_time_s: float = None,
    model_version: str = "",
    # Review state must be passed in, not inferred. It was previously deduced
    # from whether a correction existed, which made a slide the pathologist
    # confirmed *unchanged* print as "Awaiting Review" on its own signed
    # report — and a second table always printed "Reviewed" regardless.
    confirmed: bool = False,
    signed_by: str = "",
    signed_at: str = "",
) -> bytes:
    """Generate a professional clinical trial pathology PDF report."""
    if biomarkers is None:
        biomarkers = {}
    if quality is None:
        quality = {}

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        topMargin=15*mm,
        bottomMargin=15*mm,
        leftMargin=15*mm,
        rightMargin=15*mm,
    )
    s = _make_styles()
    elements = []

    # ─── Header ───
    header_data = [
        [Paragraph("OMNIA AI", s["title"]),
         Paragraph("Research Use Only", ParagraphStyle("RUO", parent=s["small"],
             textColor=RED, alignment=TA_RIGHT, fontName="Helvetica-Bold"))],
        [Paragraph("Clinical Trial Pathology Intelligence", s["subtitle"]),
         Paragraph(f"Report generated: {analysis_date or datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}",
                   ParagraphStyle("DateRight", parent=s["small"], alignment=TA_RIGHT))],
    ]
    t = Table(header_data, colWidths=[100*mm, 70*mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, DARK_BLUE),
    ]))
    elements.append(t)
    elements.append(Spacer(1, 3*mm))

    # ─── Trial Information ───
    elements.append(Paragraph("TRIAL INFORMATION", s["section_header"]))
    trial_data = [
        [Paragraph("Trial", s["label"]), Paragraph(trial_name or "—", s["value"])],
        [Paragraph("Sponsor", s["label"]), Paragraph(sponsor or "—", s["value"])],
        [Paragraph("Drug", s["label"]), Paragraph(drug or "—", s["value"])],
        [Paragraph("Patient ID", s["label"]), Paragraph(patient_id or "—", s["value_bold"])],
        [Paragraph("Visit", s["label"]), Paragraph(visit or "—", s["value"])],
        [Paragraph("Slide", s["label"]), Paragraph(slide_filename or "—", s["small"])],
        [Paragraph("Analysis Date", s["label"]), Paragraph(analysis_date or "—", s["value"])],
    ]
    t = Table(trial_data, colWidths=[30*mm, 140*mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (0, -1), 8),
        ("TEXTCOLOR", (0, 0), (0, -1), GRAY),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2*mm),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, LIGHT_GRAY),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5*mm),
    ]))
    elements.append(t)

    # ─── Pathological Assessment ───
    elements.append(Paragraph("PATHOLOGICAL ASSESSMENT", s["section_header"]))

    # Gleason grade — big result box
    if ai_grade:
        result_style = [
            ("BACKGROUND", (0, 0), (-1, 0), LIGHT_BLUE),
            ("BOX", (0, 0), (-1, -1), 0.5, DARK_BLUE),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("TOPPADDING", (0, 0), (-1, -1), 3*mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3*mm),
        ]
        grade_text = doctor_correction if doctor_correction else ai_grade
        grade_label = "Doctor-Corrected Grade" if doctor_correction else "AI-Predicted Grade"

        grade_data = [
            [Paragraph(grade_label, s["result_label"])],
            [Paragraph(grade_text, s["result_grade"])],
            [Paragraph(f"Confidence: {ai_confidence*100:.0f}%" if ai_confidence is not None else "Confidence: —", s["small"])],
        ]
        t = Table(grade_data, colWidths=[170*mm])
        t.setStyle(TableStyle(result_style))
        elements.append(t)
        elements.append(Spacer(1, 3*mm))

    # Detailed findings table
    findings_data = [
        [Paragraph("Parameter", s["label"]), Paragraph("Result", s["label"])],
        [Paragraph("Gleason Grade", s["value"]),
         Paragraph(doctor_correction or ai_grade or "Pending", s["value_bold"])],
        [Paragraph("WHO/ISUP Grade Group", s["value"]),
         Paragraph(str(grade_group) if grade_group else "—", s["value_bold"])],
        [Paragraph("Risk Category", s["value"]),
         Paragraph(risk_group or "—", s["value_bold"])],
        [Paragraph("AI Confidence", s["value"]),
         Paragraph(f"{ai_confidence*100:.1f}%" if ai_confidence is not None else "—", s["value"])],
        [Paragraph("Tumor Size", s["value"]),
         Paragraph(f"{tumor_size_mm:.1f} mm" if tumor_size_mm is not None else "—", s["value"])],
        [Paragraph("Doctor Review", s["value"]),
         Paragraph(("Reviewed & Corrected" if doctor_correction
                    else "Reviewed & Approved") if confirmed else "Awaiting Review",
                    ParagraphStyle("ReviewStatus", parent=s["value"],
                        textColor=DARK_GREEN if confirmed else GRAY))],
    ]
    t = Table(findings_data, colWidths=[40*mm, 130*mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, DARK_BLUE),
        ("LINEBELOW", (0, 1), (-1, -1), 0.3, LIGHT_GRAY),
        ("TOPPADDING", (0, 0), (-1, -1), 2*mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2*mm),
        ("BACKGROUND", (0, 0), (-1, 0), DARK_BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
    ]))
    elements.append(t)

    # ─── Key Pathological Findings ───
    if tumor_involvement_pct is not None or perineural_invasion is not None:
        elements.append(Spacer(1, 3*mm))
        elements.append(Paragraph("KEY PATHOLOGICAL FINDINGS", s["section_header"]))

        def _present_absent(val):
            if val is None:
                return "—", GRAY
            return ("Present", RED) if val else ("Absent", DARK_GREEN)

        pni_text, pni_color = _present_absent(perineural_invasion)
        lvi_text, lvi_color = _present_absent(lymphovascular_invasion)
        crib_text, crib_color = _present_absent(cribriform_pattern)

        findings_rows = [
            ("Tumor Involvement", f"{tumor_involvement_pct}%" if tumor_involvement_pct is not None else "—", GRAY),
            ("Perineural Invasion (PNI)", pni_text, pni_color),
            ("Lymphovascular Invasion (LVI)", lvi_text, lvi_color),
            ("Cribriform Pattern", crib_text, crib_color),
        ]
        kf_data = [[Paragraph("Finding", ParagraphStyle("KFH", parent=s["label"],
            textColor=WHITE, fontName="Helvetica-Bold")),
            Paragraph("Result", ParagraphStyle("KFH2", parent=s["label"],
                textColor=WHITE, fontName="Helvetica-Bold"))]]
        for name, val, color in findings_rows:
            kf_data.append([
                Paragraph(name, s["value"]),
                Paragraph(val, ParagraphStyle("KFVal", parent=s["value_bold"], textColor=color)),
            ])
        t = Table(kf_data, colWidths=[80*mm, 90*mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), DARK_BLUE),
            ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
            ("LINEBELOW", (0, 1), (-1, -1), 0.3, LIGHT_GRAY),
            ("TOPPADDING", (0, 0), (-1, -1), 2*mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2*mm),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("BOX", (0, 0), (-1, -1), 0.5, BORDER_GRAY),
        ]))
        elements.append(t)

    # ─── Biomarkers ───
    if biomarkers:
        elements.append(Spacer(1, 3*mm))
        elements.append(Paragraph("BIOMARKER STATUS", s["section_header"]))
        bio_data = [[Paragraph("Biomarker", s["label"]), Paragraph("Result", s["label"]),
                     Paragraph("Interpretation", s["label"])]]
        bio_data[0] = [Paragraph("Biomarker", ParagraphStyle("BioH", parent=s["label"],
            textColor=WHITE, fontName="Helvetica-Bold")),
            Paragraph("Result", ParagraphStyle("BioH2", parent=s["label"],
                textColor=WHITE, fontName="Helvetica-Bold")),
            Paragraph("Interpretation", ParagraphStyle("BioH3", parent=s["label"],
                textColor=WHITE, fontName="Helvetica-Bold"))]
        for name, val in biomarkers.items():
            bio_data.append([
                Paragraph(name, s["value"]),
                Paragraph(str(val.get("result", "—")), s["value_bold"]),
                Paragraph(str(val.get("interpretation", "—")), s["small"]),
            ])
        t = Table(bio_data, colWidths=[55*mm, 45*mm, 70*mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), DARK_BLUE),
            ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
            ("LINEBELOW", (0, 1), (-1, -1), 0.3, LIGHT_GRAY),
            ("TOPPADDING", (0, 0), (-1, -1), 2*mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2*mm),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("BOX", (0, 0), (-1, -1), 0.5, BORDER_GRAY),
        ]))
        elements.append(t)

    # ─── Treatment Response ───
    if treatment_response or prior_size_mm:
        elements.append(Spacer(1, 3*mm))
        elements.append(Paragraph("TREATMENT RESPONSE", s["section_header"]))
        response_data = []
        if prior_size_mm and tumor_size_mm:
            change = ((tumor_size_mm - prior_size_mm) / prior_size_mm) * 100
            direction = "↓ Reduction" if change < 0 else "↑ Increase" if change > 0 else "→ Stable"
            response_data.append(["Tumor Size Change", f"{abs(change):.0f}% {direction}",
                                  f"Prior: {prior_size_mm:.1f}mm → Current: {tumor_size_mm:.1f}mm"])
        if treatment_response:
            response_data.append(["RECIST Response", treatment_response, ""])

        resp_table_data = [
            [Paragraph("Parameter", ParagraphStyle("RH", parent=s["label"],
                textColor=WHITE, fontName="Helvetica-Bold")),
             Paragraph("Result", ParagraphStyle("RH2", parent=s["label"],
                 textColor=WHITE, fontName="Helvetica-Bold")),
             Paragraph("Details", ParagraphStyle("RH3", parent=s["label"],
                 textColor=WHITE, fontName="Helvetica-Bold"))]
        ]
        for param, result, detail in response_data:
            r_color = DARK_GREEN if "Reduction" in result else RED if "Increase" in result else GRAY
            resp_table_data.append([
                Paragraph(param, s["value"]),
                Paragraph(result, ParagraphStyle("RespResult", parent=s["value_bold"],
                    textColor=r_color)),
                Paragraph(detail, s["small"]),
            ])
        t = Table(resp_table_data, colWidths=[55*mm, 55*mm, 60*mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), DARK_BLUE),
            ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
            ("LINEBELOW", (0, 1), (-1, -1), 0.3, LIGHT_GRAY),
            ("TOPPADDING", (0, 0), (-1, -1), 2*mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2*mm),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("BOX", (0, 0), (-1, -1), 0.5, BORDER_GRAY),
        ]))
        elements.append(t)

    # ─── Pathology Review Section ───
    elements.append(Spacer(1, 3*mm))
    elements.append(Paragraph("PATHOLOGY REVIEW", s["section_header"]))
    review_data = [
        [Paragraph("AI Assessment", s["value"]),
         Paragraph(ai_grade or "Pending", s["value_bold"])],
        [Paragraph("Doctor Correction", s["value"]),
         Paragraph(doctor_correction or ("None — AI grade accepted" if confirmed
                                         else "Not yet reviewed"), s["value"])],
        [Paragraph("Review Status", s["value"]),
         # `or True` here made this branch unreachable, so an unreviewed slide
         # printed "Reviewed" — a false attestation in a regulatory document.
         Paragraph("✓ Reviewed" if confirmed else "⏳ Awaiting pathologist review",
                    ParagraphStyle("ReviewStatusValue",
                        textColor=DARK_GREEN if confirmed else GRAY,
                        fontName="Helvetica-Bold", fontSize=10))],
    ]
    if notes:
        review_data.append([Paragraph("Pathologist Notes", s["value"]),
                            Paragraph(notes, s["small"])])
    t = Table(review_data, colWidths=[40*mm, 130*mm])
    t.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, LIGHT_GRAY),
        ("TOPPADDING", (0, 0), (-1, -1), 2*mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2*mm),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    elements.append(t)

    # ─── AI Quality Metrics ───
    elements.append(Spacer(1, 4*mm))
    elements.append(Paragraph("AI ANALYSIS QUALITY", s["section_header"]))
    quality_data = [
        ["Metric", "Value"],
        ["Model", model_version or "—"],
        ["Confidence", f"{ai_confidence*100:.1f}%" if ai_confidence else "—"],
        ["Regions Analyzed", f"{regions_analyzed:,} tiles ({suspicious_regions} flagged)" if regions_analyzed else "—"],
        ["Processing Time", f"{processing_time_s:.1f}s" if processing_time_s else "—"],
        ["Tissue Quality", quality.get("tissue_quality", "—")],
        ["Staining Quality", quality.get("staining_quality", "—")],
        ["Artifacts Detected", quality.get("artifacts_detected", "—")],
    ]
    q_data = [
        [Paragraph("Metric", ParagraphStyle("QH", parent=s["label"],
            textColor=WHITE, fontName="Helvetica-Bold")),
         Paragraph("Value", ParagraphStyle("QH2", parent=s["label"],
             textColor=WHITE, fontName="Helvetica-Bold"))]]
    for m, v in quality_data[1:]:
        q_data.append([Paragraph(m, s["value"]), Paragraph(v, s["value"])])
    t = Table(q_data, colWidths=[55*mm, 115*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), DARK_BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("LINEBELOW", (0, 1), (-1, -1), 0.3, LIGHT_GRAY),
        ("TOPPADDING", (0, 0), (-1, -1), 2*mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2*mm),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER_GRAY),
    ]))
    elements.append(t)

    # ─── Disclaimer & Footer ───
    elements.append(Spacer(1, 5*mm))
    disclaimer_text = (
        "This report was generated by Omnia AI Clinical Trial Pathology Suite (Research Use Only). "
        "It is not intended for standalone clinical diagnosis. "
        "All results should be reviewed by a board-certified pathologist. "
        "The AI model used is trained on public datasets (PANDA, TCGA) and should be validated "
        "on site-specific data before use in regulatory submissions."
    )
    elements.append(Paragraph(disclaimer_text, s["disclaimer"]))
    elements.append(Spacer(1, 2*mm))
    elements.append(Paragraph(
        f"Omnia AI v1.0 | Generated {datetime.datetime.now().strftime('%Y-%m-%d %H:%M UTC')} | "
        f"Report ID: {os.urandom(4).hex().upper()}",
        s["footer"]
    ))

    doc.build(elements)
    pdf_bytes = buf.getvalue()
    buf.close()

    if output_path:
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(pdf_bytes)

    return pdf_bytes


def generate_trial_summary_pdf(
    trial_name: str,
    sponsor: str,
    drug: str,
    patients: list,
    output_path: str = None,
) -> bytes:
    """Generate a trial-wide summary PDF with all patients."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=15*mm, bottomMargin=15*mm,
                            leftMargin=15*mm, rightMargin=15*mm)
    s = _make_styles()
    elements = []

    # Header
    elements.append(Paragraph(f"TRIAL SUMMARY: {trial_name}", s["title"]))
    elements.append(Paragraph(f"{sponsor} — {drug}", s["subtitle"]))
    elements.append(Paragraph(f"Generated: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}", s["small"]))
    elements.append(Spacer(1, 5*mm))

    if not patients:
        elements.append(Paragraph("No patient data available.", s["value"]))
    else:
        # Summary stats
        total = len(patients)
        reviewed = sum(1 for p in patients if any(s.get("confirmed") for s in p.get("slides", [])))
        pending = total - reviewed
        elements.append(Paragraph(f"Total Patients: {total} | Reviewed: {reviewed} | Pending: {pending}", s["value_bold"]))
        elements.append(Spacer(1, 3*mm))

        # Patient table
        table_data = [
            [Paragraph("Patient", ParagraphStyle("TH", parent=s["label"],
                textColor=WHITE, fontName="Helvetica-Bold")),
             Paragraph("Visit", ParagraphStyle("TH2", parent=s["label"],
                 textColor=WHITE, fontName="Helvetica-Bold")),
             Paragraph("Grade", ParagraphStyle("TH3", parent=s["label"],
                 textColor=WHITE, fontName="Helvetica-Bold")),
             Paragraph("Status", ParagraphStyle("TH4", parent=s["label"],
                 textColor=WHITE, fontName="Helvetica-Bold"))]
        ]
        for p in patients:
            status_str = "✓ Reviewed" if any(s.get("confirmed") for s in p.get("slides", [])) else "⏳ Pending"
            grade_str = p.get("slides", [{}])[0].get("grade", "—") if p.get("slides") else "—"
            if grade_str is None:
                grade_str = "—"
            table_data.append([
                Paragraph(p.get("patient_id", "—"), s["value"]),
                Paragraph(p.get("visit", "—"), s["value"]),
                Paragraph(grade_str, s["value"]),
                Paragraph(status_str, ParagraphStyle("StatusCell",
                    textColor=DARK_GREEN if "Reviewed" in status_str else GRAY,
                    fontSize=9, fontName="Helvetica")),
            ])
        col_widths = [40*mm, 40*mm, 40*mm, 50*mm]
        t = Table(table_data, colWidths=col_widths)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), DARK_BLUE),
            ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
            ("LINEBELOW", (0, 1), (-1, -1), 0.3, LIGHT_GRAY),
            ("TOPPADDING", (0, 0), (-1, -1), 2*mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2*mm),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("BOX", (0, 0), (-1, -1), 0.5, BORDER_GRAY),
            ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ]))
        elements.append(t)

    # Footer
    elements.append(Spacer(1, 5*mm))
    elements.append(Paragraph(
        "Omnia AI Clinical Trial Pathology Suite — Research Use Only",
        s["footer"]))
    doc.build(elements)
    pdf_bytes = buf.getvalue()
    buf.close()

    if output_path:
        with open(output_path, "wb") as f:
            f.write(pdf_bytes)
    return pdf_bytes
