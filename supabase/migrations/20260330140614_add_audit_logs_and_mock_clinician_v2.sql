BEGIN;

-- Create an audit log table for clinical verifications
CREATE TABLE IF NOT EXISTS public.clinical_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diagnosis_id UUID REFERENCES public.diagnoses(id) NOT NULL,
    clinician_id UUID NOT NULL, -- Removed foreign key to auth.users for demo purposes
    action TEXT NOT NULL, -- 'verified', 'flagged', 're-evaluated'
    previous_status TEXT,
    new_status TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.clinical_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read for demo" ON public.clinical_audit_logs FOR SELECT USING (true);
CREATE POLICY "Allow public insert for demo" ON public.clinical_audit_logs FOR INSERT WITH CHECK (true);

-- Update clinicians table to remove foreign key to auth.users for demo purposes
ALTER TABLE public.clinicians DROP CONSTRAINT IF EXISTS clinicians_id_fkey;

-- Add a mock clinician if none exists (for the demo)
INSERT INTO public.clinicians (id, full_name, specialty, license_number)
VALUES ('00000000-0000-0000-0000-000000000000', 'Dr. Sarah Chen', 'Thoracic Radiologist', 'MD-99281-CA')
ON CONFLICT (id) DO NOTHING;

COMMIT;
