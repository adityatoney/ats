import ast
import re


class StrategyValidationError(Exception):
    pass


FORBIDDEN_MODULES = {
    "requests",
    "urllib",
    "socket",
    "os",
    "sys",
    "subprocess",
    "shutil",
    "pathlib",
    "http",
    "ftplib",
    "smtplib",
}

FORBIDDEN_CALLS = {
    "datetime.now",
    "datetime.datetime.now",
    "time.time",
    "time.sleep",
}


class StrategyValidator:
    @staticmethod
    def validate(source: str):
        # Check forbidden imports
        try:
            tree = ast.parse(source)
        except SyntaxError as e:
            raise StrategyValidationError(f"Syntax error in strategy: {e}")

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    module_root = alias.name.split(".")[0]
                    if module_root in FORBIDDEN_MODULES:
                        raise StrategyValidationError(
                            f"Forbidden import: {alias.name}"
                        )

            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    module_root = node.module.split(".")[0]
                    if module_root in FORBIDDEN_MODULES:
                        raise StrategyValidationError(
                            f"Forbidden import: {node.module}"
                        )

        # Check forbidden calls via regex
        for pattern in FORBIDDEN_CALLS:
            escaped = re.escape(pattern)
            if re.search(rf"\b{escaped}\b", source):
                raise StrategyValidationError(
                    f"Forbidden call: {pattern}"
                )
