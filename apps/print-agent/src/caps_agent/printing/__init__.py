"""Printing subsystem interfaces and adapters."""

from caps_agent.printing.engine import PrintEngine, PrintResult, PrintSettings
from caps_agent.printing.fake_engine import FakePrintEngine

__all__ = ["PrintEngine", "PrintResult", "PrintSettings", "FakePrintEngine"]
