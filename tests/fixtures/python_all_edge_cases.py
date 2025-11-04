# Edge case 1: __all__ with trailing comma
__all__ = [
    'function_one',
    'ClassTwo',
]

def function_one():
    pass

class ClassTwo:
    pass

def not_exported():
    pass
