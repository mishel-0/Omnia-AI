"""Omnia AI — investigational product profile and cheminformatics.

Stores everything a trial team knows about the compound under test, and
derives what can be computed from its structure: validated/canonical SMILES,
molecular formula, weight, lipophilicity, polar surface area, hydrogen-bond
donors and acceptors, rotatable bonds, and Lipinski rule-of-five compliance.
Those descriptors are deterministic computations over the molecular graph
(RDKit), not predictions.

── What this does NOT do, and cannot ──
The grading model is an image classifier: EfficientNet-B0 over tissue tiles
with attention pooling. It has one input channel, pixels, and one output,
an ISUP grade. There is no architectural path by which a SMILES string,
target annotation, or dose could influence its prediction, and no amount of
drug metadata stored here changes what the model computes from a slide.

So the drug profile and the histology results sit SIDE BY SIDE for a human
to interpret. They are not fused, and this module never claims they are.
Building something that reported "the compound fails because of mechanism
X" would require target-engagement data, PK/PD, resistance markers, a
control arm, and a model trained on paired structure-response data — none
of which exist here. Presenting such a conclusion from H&E morphology plus
a chemical formula would be fabrication.

What the data honestly supports is stated in `evidence_summary()`: the
observed grade trajectories, the recorded compound, and an explicit account
of which inferences those two together can and cannot bear.
"""
import os
from typing import Optional

from backend.storage import read_json, write_json, transaction

DATA_DIR = None  # resolved lazily from trials so both modules agree on location


def _drugs_file():
    from backend.trials import DATA_DIR as _D
    return _D / "drugs.json"


# Lipinski's rule of five: an orally-active drug typically violates no more
# than one of these. It is a rule of thumb about oral bioavailability, not a
# statement about efficacy.
LIPINSKI = {"mw_max": 500.0, "logp_max": 5.0, "hbd_max": 5, "hba_max": 10}


def compute_chemistry(smiles: str) -> dict:
    """Derive structural descriptors from SMILES.

    Returns {"valid": False, "error": ...} for anything RDKit cannot parse,
    rather than guessing — a silently mis-parsed structure would put wrong
    numbers in front of a chemist.
    """
    smiles = (smiles or "").strip()
    if not smiles:
        return {"valid": False, "error": "No structure provided"}
    try:
        from rdkit import Chem
        from rdkit.Chem import Descriptors, Crippen, rdMolDescriptors
        from rdkit import RDLogger
        RDLogger.DisableLog("rdApp.*")   # parse failures are returned, not printed
    except ImportError:
        return {"valid": False, "error": "Cheminformatics support is not installed in this build"}

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return {"valid": False, "error": "Not a valid SMILES string"}

    mw = Descriptors.MolWt(mol)
    logp = Crippen.MolLogP(mol)
    hbd = rdMolDescriptors.CalcNumHBD(mol)
    hba = rdMolDescriptors.CalcNumHBA(mol)

    violations = []
    if mw > LIPINSKI["mw_max"]:
        violations.append(f"MW {mw:.0f} > {LIPINSKI['mw_max']:.0f}")
    if logp > LIPINSKI["logp_max"]:
        violations.append(f"logP {logp:.1f} > {LIPINSKI['logp_max']:.0f}")
    if hbd > LIPINSKI["hbd_max"]:
        violations.append(f"HBD {hbd} > {LIPINSKI['hbd_max']}")
    if hba > LIPINSKI["hba_max"]:
        violations.append(f"HBA {hba} > {LIPINSKI['hba_max']}")

    out = {
        "valid": True,
        "canonical_smiles": Chem.MolToSmiles(mol),
        "formula": rdMolDescriptors.CalcMolFormula(mol),
        "molecular_weight": round(mw, 2),
        "logp": round(logp, 2),
        "tpsa": round(Descriptors.TPSA(mol), 1),
        "hbd": hbd,
        "hba": hba,
        "rotatable_bonds": rdMolDescriptors.CalcNumRotatableBonds(mol),
        "aromatic_rings": rdMolDescriptors.CalcNumAromaticRings(mol),
        "heavy_atoms": mol.GetNumHeavyAtoms(),
        "fraction_csp3": round(rdMolDescriptors.CalcFractionCSP3(mol), 3),
        "lipinski_violations": violations,
        "lipinski_pass": len(violations) <= 1,
    }
    try:
        out["inchikey"] = Chem.MolToInchiKey(mol)
    except Exception:
        out["inchikey"] = None
    return out


def render_structure_png(smiles: str, size: int = 320) -> Optional[bytes]:
    """2D depiction of the structure, or None if it cannot be drawn."""
    try:
        from rdkit import Chem
        from rdkit.Chem.Draw import rdMolDraw2D
        from rdkit import RDLogger
        RDLogger.DisableLog("rdApp.*")
    except ImportError:
        return None
    mol = Chem.MolFromSmiles((smiles or "").strip())
    if mol is None:
        return None
    d = rdMolDraw2D.MolDraw2DCairo(size, size)
    d.drawOptions().clearBackground = False
    rdMolDraw2D.PrepareAndDrawMolecule(d, mol)
    d.FinishDrawing()
    return d.GetDrawingText()


def get_drug(trial_id: str) -> Optional[dict]:
    for d in read_json(_drugs_file(), []):
        if d.get("trial_id") == trial_id:
            return d
    return None


def upsert_drug(trial_id: str, fields: dict) -> dict:
    """Create or update the investigational product record for a trial.

    Sponsor-supplied claims (target, mechanism) are stored verbatim and are
    labelled as such wherever shown — they are assertions about the compound,
    not anything this system verified.
    """
    allowed = {
        "name", "code", "drug_class", "target", "mechanism", "modality",
        "dose", "route", "schedule", "smiles", "comparator", "notes",
    }
    record = get_drug(trial_id) or {"trial_id": trial_id}
    for k, v in fields.items():
        if k in allowed and v is not None:
            record[k] = str(v).strip()

    record["chemistry"] = compute_chemistry(record.get("smiles", ""))

    with transaction():
        drugs = read_json(_drugs_file(), [])
        drugs = [d for d in drugs if d.get("trial_id") != trial_id]
        drugs.append(record)
        write_json(_drugs_file(), drugs)
    return record


def delete_drug(trial_id: str) -> bool:
    with transaction():
        drugs = read_json(_drugs_file(), [])
        remaining = [d for d in drugs if d.get("trial_id") != trial_id]
        if len(remaining) == len(drugs):
            return False
        write_json(_drugs_file(), remaining)
    return True


def evidence_summary(trial_id: str, patients: list) -> dict:
    """Lay the compound record and the observed histology side by side, and
    state precisely what that pairing can and cannot support.

    This is the honest form of "is it working": the evidence is presented,
    the inferential limits are named, and the causal judgement is left to
    the investigator, who has the protocol, the comparator arm, and the
    clinical data this system does not.
    """
    from backend.cohort_insights import build_cohort_insights

    drug = get_drug(trial_id)
    cohort = build_cohort_insights(trial_id, patients)
    t = cohort["trajectory_counts"]
    paired = cohort["subjects_with_paired_timepoints"]

    # Everything below is a statement about what was OBSERVED, never about cause.
    observations = []
    if paired == 0:
        observations.append(
            "No subject yet has two graded visits, so no within-subject change "
            "has been observed."
        )
    else:
        observations.append(
            f"{paired} subject{'s' if paired != 1 else ''} have two or more graded "
            f"visits. Of these, {t['lower']} recorded a lower grade group at the "
            f"last visit than the first, {t['higher']} a higher one, and "
            f"{t['unchanged']} no change."
        )
    if cohort["significant_movers"]:
        n = len(cohort["significant_movers"])
        observations.append(
            f"{n} change{'s' if n != 1 else ''} exceeded the model's margin of error "
            f"(at least {2} grade groups)."
        )
    else:
        observations.append(
            "No change exceeded the model's margin of error, so every movement "
            "recorded so far is within measurement noise."
        )
    if cohort["unsigned_slide_count"]:
        observations.append(
            f"{cohort['unsigned_slide_count']} graded slide"
            f"{'s are' if cohort['unsigned_slide_count'] != 1 else ' is'} not "
            f"pathologist-signed, so the figures above are provisional."
        )

    # The limits are not boilerplate — each one names a specific missing input
    # that a working/not-working judgement would require.
    limits = [
        "No comparator or control arm is recorded here, so observed change cannot "
        "be separated from natural history.",
        "No dosing, exposure, PK/PD or target-engagement data is held, so it is "
        "unknown whether subjects received active compound at the intended "
        "concentration at the tissue.",
        "No biomarker, genomic or resistance data is held, so no mechanistic "
        "explanation for any observed change can be supported.",
        "ISUP grade from serial biopsies is confounded by sampling: repeat cores "
        "may not capture the same tissue.",
        "The grading model reads morphology only. It does not receive the "
        "compound's structure, target or dose, and those inputs cannot influence "
        "its output.",
    ]

    can_conclude = (
        "Whether recorded grade moved, in which subjects, and by how much — "
        "against the model's known error."
    )
    cannot_conclude = (
        "Whether the investigational product is effective, why it may not be, or "
        "where in its mechanism a problem lies. Those require a controlled "
        "comparison and exposure/biomarker data this system does not hold."
    )

    return {
        "trial_id": trial_id,
        "drug": drug,
        "observations": observations,
        "limits": limits,
        "can_conclude": can_conclude,
        "cannot_conclude": cannot_conclude,
        "cohort": {
            "subject_count": cohort["subject_count"],
            "graded_slide_count": cohort["graded_slide_count"],
            "signed_slide_count": cohort["signed_slide_count"],
            "subjects_with_paired_timepoints": paired,
            "trajectory_counts": t,
            "significant_movers": cohort["significant_movers"],
            "grade_distribution": cohort["grade_distribution"],
            "mean_confidence": cohort["mean_confidence"],
        },
    }
