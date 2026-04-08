BEGIN;

-- Create a table for AI detection models to simulate real-time processing
CREATE TABLE IF NOT EXISTS public.ai_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    type TEXT NOT NULL, -- 'lung', 'skin'
    parameters JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.ai_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON public.ai_models FOR SELECT USING (true);

-- Insert a mock AI model
INSERT INTO public.ai_models (name, version, type, parameters)
VALUES ('Omnia-Lung-V2', '2.4.1', 'lung', '{"threshold": 0.85, "sensitivity": 0.92}'::jsonb)
ON CONFLICT DO NOTHING;

-- Add a column to diagnoses to track which AI model was used
ALTER TABLE public.diagnoses ADD COLUMN IF NOT EXISTS ai_model_id UUID REFERENCES public.ai_models(id);

COMMIT;
