"""
Konnektor k ldbsearch - vypolnenie zaprosov k LDB bazam Samba.

ldbsearch - utilita komandnoj stroki dlya poiska v LDB bazah dannyh.
My vyzyvaem ee cherez subprocess i parsim LDIF vyvod.

Podderzhivaet zapusk cherez sudo dlya dostupa k LDB fajlam,
kotorye dostupny tol'ko root.
"""

import subprocess
import os
from typing import List, Optional

from app.sdb_lib.config import LDBSEARCH_PATH, get_ldb_path
from app.sdb_lib.parser.ldif import LdifParser, LdifRecord


class LdbConnector:
    """
    Konnektor k ldbsearch dlya vypolneniya zaprosov k LDB bazam.

    Podderzhivaet zapusk cherez sudo (use_sudo=True), chto neobhodimo
    dlya dostupa k bazam Samba, kotorye dostupny tol'ko root.
    """

    def __init__(self, database: str = "sam", use_sudo: bool = True):
        self.ldb_path = get_ldb_path(database)
        self.url = self.ldb_path
        self.use_sudo = use_sudo

    def use_database(self, database: str) -> str:
        """Pereklyuchit'sya na druguyu bazu dannyh."""
        self.ldb_path = get_ldb_path(database)
        self.url = self.ldb_path
        return self.ldb_path

    def query(
        self,
        filter_expr: str = "",
        attrs: Optional[List[str]] = None,
        base_dn: Optional[str] = None,
        scope: Optional[str] = None,
        controls: Optional[List[str]] = None,
    ) -> List[LdifRecord]:
        """
        Vypolnit' zapros k LDB baze cherez ldbsearch.

        Args:
            filter_expr: LDAP fil'tr
            attrs: Spisok atributov (None = vse)
            base_dn: Bazovyj DN (-b parametr)
            scope: Oblast' poiska: sub, one, base (-s parametr)
            controls: Dopolnitel'nye kontroli LDAP

        Returns:
            Spisok LdifRecord s rezul'tatami
        """
        cmd = self._build_command(filter_expr, attrs, base_dn, scope, controls)

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60,
            )
        except FileNotFoundError:
            raise RuntimeError(
                f"ldbsearch ne najden po puti '{LDBSEARCH_PATH}'. "
                f"Ustanovite samba-tools i ubedites', chto ldbsearch v PATH."
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError("ldbsearch: tajmaut zaprosa (60 sek)")

        if result.returncode != 0 and result.stderr:
            stderr_lower = result.stderr.lower()
            if "no such" in stderr_lower or "unable to open" in stderr_lower:
                raise RuntimeError(
                    f"Ne udalos' otkryt' bazu: {self.ldb_path}. "
                    f"Prover'te put' i prava dostupa."
                )
            if "permission denied" in stderr_lower:
                raise RuntimeError(
                    f"Otkazano v dostupe k baze: {self.ldb_path}. "
                    f"Zapustite s flagom --sudo."
                )

        parser = LdifParser()
        records = parser.parse(result.stdout)
        return records

    def query_by_dn(self, dn: str, attrs: Optional[List[str]] = None) -> Optional[LdifRecord]:
        """Poluchit' zapis' po DN."""
        records = self.query(
            filter_expr="",
            attrs=attrs,
            base_dn=dn,
            scope="base",
        )
        return records[0] if records else None

    def search_term(self, term: str, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """Poisk podstroke - ischet term v lyubom atribute."""
        term_escaped = self._escape_ldap_filter(term)
        filter_expr = f"(cn=*{term_escaped}*)"
        records = self.query(filter_expr=filter_expr, attrs=attrs)

        if not records:
            filter_expr2 = f"(sAMAccountName=*{term_escaped}*)"
            records = self.query(filter_expr=filter_expr2, attrs=attrs)

        if not records:
            filter_expr3 = f"(description=*{term_escaped}*)"
            records = self.query(filter_expr=filter_expr3, attrs=attrs)

        return records

    def list_all(self, attrs: Optional[List[str]] = None) -> List[LdifRecord]:
        """Poluchit' vse zapisi iz bazy."""
        return self.query(filter_expr="", attrs=attrs)

    def _build_command(
        self,
        filter_expr: str,
        attrs: Optional[List[str]],
        base_dn: Optional[str],
        scope: Optional[str],
        controls: Optional[List[str]],
    ) -> List[str]:
        """Postroit' komandu ldbsearch (s sudo esli nuzhno)."""
        cmd = []

        if self.use_sudo:
            cmd.append("sudo")

        cmd.extend([LDBSEARCH_PATH, "-H", self.url])

        if base_dn:
            cmd.extend(["-b", base_dn])

        if scope:
            cmd.extend(["-s", scope])

        if filter_expr:
            if not filter_expr.startswith("("):
                filter_expr = f"({filter_expr})"
            cmd.append(filter_expr)

        if attrs:
            cmd.extend(attrs)

        if controls:
            for ctrl in controls:
                cmd.extend(["--controls", ctrl])

        return cmd

    @staticmethod
    def _escape_ldap_filter(value: str) -> str:
        """Ekranirovat' special'nye simvoly LDAP fil'tra."""
        replacements = {
            "\\": "\\5c",
            "*": "\\2a",
            "(": "\\28",
            ")": "\\29",
            "/": "\\2f",
            "\x00": "\\00",
        }
        result = value
        for char, escaped in replacements.items():
            result = result.replace(char, escaped)
        return result

    def __repr__(self) -> str:
        sudo_str = "sudo " if self.use_sudo else ""
        return f"LdbConnector({sudo_str}url={self.url!r})"
