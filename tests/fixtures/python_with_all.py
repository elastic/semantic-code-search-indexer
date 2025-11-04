__all__ = ['public_function', 'PublicClass']

def public_function():
    """A public function that should be exported."""
    pass

def _private_helper():
    """A private helper that should NOT be exported."""
    pass

class PublicClass:
    """A public class that should be exported."""
    pass

SECRET_CONSTANT = 42
