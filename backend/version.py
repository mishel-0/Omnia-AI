"""Single source of truth for the application version.

Before this existed the version was written in three places — package.json,
a hardcoded string in the setup wizard, and another in the /health payload —
and all three had drifted apart (1.1.3 / 1.0.1 / 1.0.0). A user reading
"Version 1.0.1" in the installer while running 1.1.3 has no way to report a
bug accurately, and support cannot tell what they are actually running.

Keep this in step with package.json. tests/integration_api_test.py fails if
they diverge, so the drift cannot silently return.
"""
__version__ = "1.6.0"
