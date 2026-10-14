"""Compatibility entry point for the current numbering integration suite."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name("numbering-smoke.py")), run_name="__main__")
