"""Omnia AI — Routes Package — Only pathology routes loaded."""
from backend.routes.license import router as license_router
from backend.routes.trials import router as trials_router
from backend.routes.patients import router as patients_router
from backend.routes.reports import router as reports_router
from backend.routes.analysis import router as analysis_router
from backend.routes.users import router as users_router
from backend.routes.audit import router as audit_router
from backend.routes.queries import router as queries_router
from backend.routes.training import router as training_router
from backend.routes.batch import router as batch_router
from backend.routes.gdpr import router as gdpr_router
