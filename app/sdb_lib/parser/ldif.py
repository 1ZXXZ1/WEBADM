"""
Parser LDIF - preobrazuet vyvod ldbsearch v strukturirovannye dannye.

LDIF format (LDAP Data Interchange Format) - tekstovyj format dlya zapisej LDAP.
Kazhdaya zapis' razdelena pustoj strokoj i nachinaetsya s kommentariya "# record N".

Podderzhivaet:
  - Obychnye atributy:   key: value
  - Base64 atributy:    key:: base64value
  - Mnozhestvennye znacheniya dlya odnogo atributa
  - Prodolzhenie strok (folded lines) - stroki, perenesennye s probelom v nachale
"""

import os
import base64
from typing import List, Dict, Optional, Any


class LdifRecord:
    """
    Odna LDIF-zapis'. Hranit DN i vse atributy.

    Attributes:
        dn: Distinguished Name zapisi
        attrs: Slovar' {imya_atributa: [znachenie1, znachenie2, ...]}
    """

    def __init__(self, dn: str = "", attrs: Optional[Dict[str, List[str]]] = None):
        self.dn = dn
        self.attrs = attrs or {}

    def get(self, attr: str, default: Any = None) -> Any:
        """
        Poluchit' pervoe znachenie atributa.

        Args:
            attr: Imya atributa
            default: Znachenie po umolchaniyu, esli atribut ne najden

        Returns:
            Pervoe znachenie atributa ili default
        """
        values = self.attrs.get(attr, [])
        return values[0] if values else default

    def get_all(self, attr: str) -> List[str]:
        """
        Poluchit' vse znacheniya atributa (mnozhestvennye znacheniya).

        Args:
            attr: Imya atributa

        Returns:
            Spisok vseh znachenij atributa
        """
        return self.attrs.get(attr, [])

    def has_attr(self, attr: str) -> bool:
        """Proverit', sushchestvuet li atribut v zapisi."""
        return attr in self.attrs

    @property
    def object_class(self) -> Optional[str]:
        """Pervyj objectClass zapisi."""
        return self.get("objectClass")

    @property
    def all_object_classes(self) -> List[str]:
        """Vse objectClass zapisi."""
        return self.get_all("objectClass")

    def to_dict(self, include_dn: bool = True) -> Dict[str, Any]:
        """
        Preobrazovat' zapis' v slovar'.

        Dlya atributov s odnim znacheniem - stroka,
        dlya mnozhestvennyh - spisok strok.

        Args:
            include_dn: Vklyuchat' li DN v rezul'tat

        Returns:
            Slovar' s atributami zapisi
        """
        result = {}
        if include_dn and self.dn:
            result["dn"] = self.dn
        for key, values in self.attrs.items():
            if len(values) == 1:
                result[key] = values[0]
            else:
                result[key] = values
        return result

    def flatten(self, include_dn: bool = True) -> Dict[str, str]:
        """
        "Splyushchit'" zapis' - mnozhestvennye znacheniya ob"edinit' cherez '; '.

        Args:
            include_dn: Vklyuchat' li DN

        Returns:
            Slovar', gde vse znacheniya - stroki
        """
        result = {}
        if include_dn and self.dn:
            result["dn"] = self.dn
        for key, values in self.attrs.items():
            result[key] = "; ".join(values)
        return result

    def __repr__(self) -> str:
        return f"LdifRecord(dn={self.dn!r}, attrs={len(self.attrs)} keys)"

    def __eq__(self, other):
        if not isinstance(other, LdifRecord):
            return False
        return self.dn == other.dn and self.attrs == other.attrs


class LdifParser:
    """
    Parser LDIF vyvoda ot ldbsearch.

    Obrabatyvaet:
      - Zapisi vida "# record N" + atributy
      - Atributy v formate  key: value  i  key:: base64value
      - Perenos strok (folded lines) - prodolzhenie stroki nachinaetsya s probela
      - Final'naya statistika "# returned N records / # N entries / # M referrals"
    """

    def __init__(self, skip_referrals: bool = True):
        """
        Inicializaciya parsera.

        Args:
            skip_referrals: Propuskat' LDAP-referraly (zapisi s atributom ref:,
                            kotorye ldbsearch vozvrashchaet kak pustye zapisi).
                            Po umolchaniyu True - referraly ne vklyuchayutsya v rezul'tat.
        """
        self.records: List[LdifRecord] = []
        self.referrals: int = 0
        self.total: int = 0
        self.skip_referrals = skip_referrals

    def parse(self, text: str) -> List[LdifRecord]:
        """
        Razobrat' polnyj LDIF tekst.

        Args:
            text: Tekst LDIF vyvoda

        Returns:
            Spisok LdifRecord (bez referralov esli skip_referrals=True)
        """
        self.records = []
        self.referrals = 0
        self.total = 0

        if not text or not text.strip():
            return self.records

        lines = text.split("\n")

        # Snachala "razvoraChivaem" perenesennye stroki (folded lines)
        unfolded = self._unfold_lines(lines)

        # Razbivaem na bloki zapisej
        blocks = self._split_into_blocks(unfolded)

        for block_lines in blocks:
            record = self._parse_block(block_lines)
            if record is not None:
                # Propuskaem LDAP-referraly (pustye zapisi s ref: atributom)
                if self.skip_referrals and self._is_referral(record):
                    self.referrals += 1
                    continue
                self.records.append(record)

        self.total = len(self.records)
        return self.records

    @staticmethod
    def _is_referral(record: LdifRecord) -> bool:
        """
        Proverit', yavlyaetsya li zapis' LDAP-referralom.

        Referraly - eto special'nye zapisi, kotorye ldbsearch vozvrashchaet
        dlya ukazaniya na drugie chasti dereva LDAP. Oni soderzhat atribut
        ref: s URL ldap://... i obychno imeyut pustoj DN.

        Args:
            record: Zapis' dlya proverki

        Returns:
            True esli eto referral
        """
        if record.has_attr("ref"):
            return True
        if not record.dn and not record.attrs:
            return True
        return False

    def _unfold_lines(self, lines: List[str]) -> List[str]:
        """
        Obrabotat' perenesennye stroki (folded lines).

        V LDIF dlinnye stroki mogut byt' razbity: prodolzhenie nachinaetsya
        s odnogo probela. My skleivaem ih obratno.

        Args:
            lines: Iskhodnye stroki

        Returns:
            Razvernutye stroki
        """
        result = []
        for line in lines:
            if line.startswith(" ") and result:
                result[-1] += line[1:]
            else:
                result.append(line)
        return result

    def _split_into_blocks(self, lines: List[str]) -> List[List[str]]:
        """
        Razbit' stroki na bloki zapisej.

        Blok nachinaetsya s "# record N" i zakanchivaetsya pustoj strokoj
        ili nachalom sleduyushchego "# record".

        Args:
            lines: Razvernutye stroki

        Returns:
            Spisok blokov (kazhdyj blok - spisok strok)
        """
        blocks = []
        current_block: List[str] = []

        for line in lines:
            stripped = line.strip()

            if stripped.startswith("# record "):
                if current_block:
                    blocks.append(current_block)
                current_block = []
                continue

            if stripped.startswith("# returned ") or stripped.startswith("# ") and "entries" in stripped:
                if current_block:
                    blocks.append(current_block)
                    current_block = []
                continue
            if stripped.startswith("# ") and "referrals" in stripped:
                continue

            if not stripped:
                if current_block:
                    blocks.append(current_block)
                    current_block = []
                continue

            if stripped.startswith("#"):
                continue

            current_block.append(stripped)

        if current_block:
            blocks.append(current_block)

        return blocks

    def _parse_block(self, lines: List[str]) -> Optional[LdifRecord]:
        """
        Razobrat' odin blok (odnu LDIF-zapis').

        Args:
            lines: Stroki bloka

        Returns:
            LdifRecord ili None, esli blok pustoj
        """
        dn = ""
        attrs: Dict[str, List[str]] = {}

        for line in lines:
            if not line.strip():
                continue

            if ":: " in line:
                sep_idx = line.index(":: ")
                key = line[:sep_idx].strip()
                b64_value = line[sep_idx + 3:].strip()
                try:
                    value = base64.b64decode(b64_value).decode("utf-8", errors="replace")
                except Exception:
                    value = b64_value
            elif ": " in line:
                sep_idx = line.index(": ")
                key = line[:sep_idx].strip()
                value = line[sep_idx + 2:].strip()
            else:
                continue

            if key.lower() == "dn":
                dn = value
            elif key.lower() == "distinguishedname":
                pass
            else:
                key_lower = key
                if key_lower not in attrs:
                    attrs[key_lower] = []
                attrs[key_lower].append(value)

        if not dn and not attrs:
            return None

        return LdifRecord(dn=dn, attrs=attrs)


def parse_ldif_string(text: str) -> List[LdifRecord]:
    """
    Bystraya funkciya: razobrat' LDIF iz stroki.

    Args:
        text: Tekst LDIF

    Returns:
        Spisok LdifRecord
    """
    parser = LdifParser()
    return parser.parse(text)


def parse_ldif_file(filepath: str, encoding: str = "utf-8") -> List[LdifRecord]:
    """
    Bystraya funkciya: razobrat' LDIF iz fajla.

    Args:
        filepath: Put' k LDIF fajlu
        encoding: Kodirovka fajla

    Returns:
        Spisok LdifRecord
    """
    with open(filepath, "r", encoding=encoding) as f:
        text = f.read()
    return parse_ldif_string(text)
