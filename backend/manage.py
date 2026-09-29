#!/usr/bin/env python
import os
import sys

# Prevent OpenBLAS/OpenMP memory allocation failures in multi-threaded environments on Windows
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["VECLIB_MAXIMUM_THREADS"] = "1"
os.environ["NUMEXPR_NUM_THREADS"] = "1"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

def main():
    # Ensure backend directory is in sys.path for module resolution
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "ai_interviewer.settings")

    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError("Couldn't import Django.") from exc
    execute_from_command_line(sys.argv)

if __name__ == "__main__":
    main()
