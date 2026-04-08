BEGIN;

-- Add metadata column to diagnoses for region-specific data
ALTER TABLE public.diagnoses ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Create a table for clinician profiles to simulate real authentication/authorization
CREATE TABLE IF NOT EXISTS public.clinicians (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    full_name TEXT NOT NULL,
    specialty TEXT NOT NULL,
    license_number TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on clinicians
ALTER TABLE public.clinicians ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read for demo" ON public.clinicians FOR SELECT USING (true);

-- Update the seed diagnosis with some region metadata
UPDATE public.diagnoses 
SET metadata = '{
    "regions": [
        {"id": "r1", "x": 65, "y": 35, "label": "Right Upper Lobe", "finding": "6mm Nodule", "confidence": 0.94},
        {"id": "r2", "x": 30, "y": 55, "label": "Left Lower Lobe", "finding": "Clear", "confidence": 0.98}
    ]
}'::jsonb
WHERE patient_id = 'PT-8829';

COMMIT;
