__all__ = ['foo']

def foo():
    """Should NOT be exported (overridden by second __all__)."""
    pass

def bar():
    """Should be exported (in second __all__)."""
    pass

__all__ = ['bar']  # Reassignment - should use this one
