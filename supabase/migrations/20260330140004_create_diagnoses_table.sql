BEGIN;

CREATE TABLE IF NOT EXISTS public.diagnoses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    patient_id TEXT NOT NULL,
    type TEXT NOT NULL, -- 'lung', 'skin'
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'verified', 'flagged'
    risk_level TEXT NOT NULL,
    finding TEXT NOT NULL,
    recommendation TEXT NOT NULL,
    verified_at TIMESTAMP WITH TIME ZONE,
    verified_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.diagnoses ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Allow public read access for demo" ON public.diagnoses
    FOR SELECT USING (true);

CREATE POLICY "Allow public update for demo" ON public.diagnoses
    FOR UPDATE USING (true);

-- Insert a seed record for the hero section
INSERT INTO public.diagnoses (patient_id, type, status, risk_level, finding, recommendation)
VALUES ('PT-8829', 'lung', 'pending', 'Moderate', 'Pulmonary Nodule', 'Schedule follow-up CT scan within 14 days for detailed characterization.')
ON CONFLICT DO NOTHING;

COMMIT;
