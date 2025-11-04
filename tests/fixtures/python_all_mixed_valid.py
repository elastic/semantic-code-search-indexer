__all__ = ['existing_function', 'nonexistent_function']

def existing_function():
    """Function that exists and is in __all__."""
    pass

def not_in_all():
    """Function that exists but is NOT in __all__."""
    pass
