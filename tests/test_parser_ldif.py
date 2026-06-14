"""
Тесты парсера LDIF — sdb.parser.ldif

Проверяет:
  - Разбор стандартного LDIF вывода ldbsearch
  - Обработку Base64-кодированных значений
  - Множожественные значения атрибутов
  - Перенос строк (folded lines)
  - Фильтрацию рефералов (referrals)
  - Пустой ввод
  - Разбор блоков и записей
  - LdifRecord методы (get, get_all, has_attr, to_dict, flatten)
  - Функции parse_ldif_string и parse_ldif_file
"""

import os
import tempfile
import pytest

from sdb.parser.ldif import LdifParser, LdifRecord, parse_ldif_string, parse_ldif_file
from tests.conftest import (
    SAMPLE_LDIF_SAM_USERS,
    SAMPLE_LDIF_PRIVILEGE,
    SAMPLE_LDIF_IDMAP,
    SAMPLE_LDIF_EMPTY,
    SAMPLE_LDIF_BASE64,
    SAMPLE_LDIF_REFERRAL,
    SAMPLE_LDIF_FOLDED,
    SAMPLE_LDIF_MULTI_VALUE,
    parse_ldif,
)


class TestLdifParserBasic:
    """Базовые тесты парсинга LDIF."""

    def test_parse_empty_string(self):
        """Пустая строка должна возвращать пустой список."""
        records = parse_ldif("")
        assert records == []

    def test_parse_none_like_empty(self):
        """Строка из пробелов — как пустая."""
        records = parse_ldif("   \n  \n")
        assert records == []

    def test_parse_sam_users(self):
        """Разбор SAM базы с пользователями, группами, компьютерами."""
        records = parse_ldif(SAMPLE_LDIF_SAM_USERS)
        # Должно быть 7 записей (8 LDIF блоков минус 1 реферал)
        assert len(records) == 7

    def test_parse_privilege(self):
        """Разбор privilege.ldb."""
        records = parse_ldif(SAMPLE_LDIF_PRIVILEGE)
        assert len(records) == 2

    def test_parse_idmap(self):
        """Разбор idmap.ldb."""
        records = parse_ldif(SAMPLE_LDIF_IDMAP)
        assert len(records) == 3


class TestLdifParserDn:
    """Проверка корректности извлечения DN."""

    def test_user_dn(self):
        """DN пользователя извлекается корректно."""
        records = parse_ldif(SAMPLE_LDIF_SAM_USERS)
        user_records = [r for r in records if r.get("sAMAccountName") == "Administrator"]
        assert len(user_records) == 1
        assert user_records[0].dn == "CN=Administrator,CN=Users,DC=kcrb,DC=local"

    def test_group_dn(self):
        """DN группы извлекается корректно."""
        records = parse_ldif(SAMPLE_LDIF_SAM_USERS)
        group_records = [r for r in records if r.get("sAMAccountName") == "Domain Users"]
        assert len(group_records) == 1
        assert "Domain Users" in group_records[0].dn

    def test_dn_case_insensitive_key(self):
        """Ключ 'dn' распознаётся независимо от регистра."""
        ldif = """# record 1
DN: CN=Test,CN=Users,DC=test,DC=local
cn: Test

"""
        records = parse_ldif(ldif)
        assert len(records) == 1
        # DN парсится через key.lower() == "dn"
        assert records[0].dn == "CN=Test,CN=Users,DC=test,DC=local"


class TestLdifParserAttributes:
    """Проверка извлечения и доступа к атрибутам."""

    def test_single_value_attribute(self):
        """Однозначный атрибут извлекается через get()."""
        records = parse_ldif(SAMPLE_LDIF_SAM_USERS)
        admin = [r for r in records if r.get("sAMAccountName") == "Administrator"][0]
        assert admin.get("cn") == "Administrator"

    def test_multi_value_attribute(self):
        """Многозначный атрибут — через get_all()."""
        records = parse_ldif(SAMPLE_LDIF_SAM_USERS)
        dom_users = [r for r in records if r.get("sAMAccountName") == "Domain Users"][0]
        members = dom_users.get_all("member")
        assert len(members) == 3
        assert "CN=Administrator,CN=Users,DC=kcrb,DC=local" in members

    def test_missing_attribute_returns_default(self):
        """Отсутствующий атрибут возвращает default."""
        records = parse_ldif(SAMPLE_LDIF_SAM_USERS)
        admin = [r for r in records if r.get("sAMAccountName") == "Administrator"][0]
        assert admin.get("nonexistent") is None
        assert admin.get("nonexistent", "N/A") == "N/A"

    def test_has_attr(self):
        """has_attr() проверяет наличие атрибута."""
        records = parse_ldif(SAMPLE_LDIF_SAM_USERS)
        admin = [r for r in records if r.get("sAMAccountName") == "Administrator"][0]
        assert admin.has_attr("cn") is True
        assert admin.has_attr("nonexistent") is False

    def test_object_class_property(self):
        """Свойство object_class возвращает первый objectClass."""
        records = parse_ldif(SAMPLE_LDIF_SAM_USERS)
        admin = [r for r in records if r.get("sAMAccountName") == "Administrator"][0]
        assert admin.object_class == "user"

    def test_all_object_classes(self):
        """Свойство all_object_classes возвращает все objectClass."""
        records = parse_ldif(SAMPLE_LDIF_SAM_USERS)
        admin = [r for r in records if r.get("sAMAccountName") == "Administrator"][0]
        classes = admin.all_object_classes
        assert "user" in classes
        assert "person" in classes
        assert len(classes) == 3


class TestLdifParserBase64:
    """Проверка Base64-кодированных значений."""

    def test_base64_attribute(self):
        """Base64-кодированный атрибут декодируется."""
        records = parse_ldif(SAMPLE_LDIF_BASE64)
        assert len(records) == 1
        user = records[0]
        # unicodePwd = VGVzdFBhc3N3b3JkMTIzIQ== → "TestPassword123!"
        pwd = user.get("unicodePwd")
        assert pwd is not None
        assert len(pwd) > 0

    def test_base64_sid(self):
        """Base64 SID декодируется."""
        records = parse_ldif(SAMPLE_LDIF_SAM_USERS)
        computer = [r for r in records if r.get("sAMAccountName") == "DC01$"][0]
        sid = computer.get("objectSid")
        assert sid is not None


class TestLdifParserReferrals:
    """Проверка фильтрации рефералов."""

    def test_referrals_filtered_by_default(self):
        """Рефералы фильтруются по умолчанию."""
        parser = LdifParser(skip_referrals=True)
        records = parser.parse(SAMPLE_LDIF_REFERRAL)
        # Должна быть только 1 запись (реферал отфильтрован)
        assert len(records) == 1
        assert records[0].get("sAMAccountName") == "Admin"

    def test_referrals_kept_when_not_skipped(self):
        """Рефералы не фильтруются если skip_referrals=False."""
        parser = LdifParser(skip_referrals=False)
        records = parser.parse(SAMPLE_LDIF_REFERRAL)
        assert len(records) == 2

    def test_referral_count(self):
        """Счётчик рефералов увеличивается."""
        parser = LdifParser(skip_referrals=True)
        parser.parse(SAMPLE_LDIF_REFERRAL)
        assert parser.referrals == 1

    def test_is_referral_with_ref_attr(self):
        """Запись с атрибутом ref — это реферал."""
        rec = LdifRecord(dn="", attrs={"ref": ["ldap://kcrb.local/..."]})
        assert LdifParser._is_referral(rec) is True

    def test_is_not_referral_normal_record(self):
        """Обычная запись — не реферал."""
        rec = LdifRecord(dn="CN=Test", attrs={"cn": ["Test"]})
        assert LdifParser._is_referral(rec) is False


class TestLdifParserFoldedLines:
    """Проверка обработки перенесённых строк (folded lines)."""

    def test_folded_cn(self):
        """Перенесённое значение cn склеивается."""
        records = parse_ldif(SAMPLE_LDIF_FOLDED)
        assert len(records) == 1
        cn = records[0].get("cn")
        assert "VeryLongName ThatIsSplitAcrossMultiple" in cn
        assert "Lines" in cn

    def test_folded_description(self):
        """Перенесённое значение description склеивается."""
        records = parse_ldif(SAMPLE_LDIF_FOLDED)
        desc = records[0].get("description")
        assert desc is not None
        assert "spans multiple" in desc
        assert "properly joined" in desc


class TestLdifParserMultiValue:
    """Проверка многозначных атрибутов."""

    def test_three_members(self):
        """Три значения member извлекаются."""
        records = parse_ldif(SAMPLE_LDIF_MULTI_VALUE)
        assert len(records) == 1
        members = records[0].get_all("member")
        assert len(members) == 3

    def test_privilege_multi_value(self):
        """Несколько привилегий у Administrators."""
        records = parse_ldif(SAMPLE_LDIF_PRIVILEGE)
        admins = [r for r in records if r.get("comment") == "Administrators"][0]
        privs = admins.get_all("privilege")
        assert len(privs) == 5
        assert "SeBackupPrivilege" in privs
        assert "SeDebugPrivilege" in privs


class TestLdifRecord:
    """Тесты методов LdifRecord."""

    def test_get_first_value(self):
        """get() возвращает первое значение."""
        rec = LdifRecord(dn="CN=T", attrs={"attr": ["v1", "v2", "v3"]})
        assert rec.get("attr") == "v1"

    def test_get_all_values(self):
        """get_all() возвращает все значения."""
        rec = LdifRecord(dn="CN=T", attrs={"attr": ["v1", "v2", "v3"]})
        assert rec.get_all("attr") == ["v1", "v2", "v3"]

    def test_get_missing_returns_default(self):
        """get() от отсутствующего атрибута возвращает default."""
        rec = LdifRecord(dn="CN=T", attrs={})
        assert rec.get("missing") is None
        assert rec.get("missing", "default") == "default"

    def test_get_all_missing_returns_empty(self):
        """get_all() от отсутствующего возвращает []."""
        rec = LdifRecord(dn="CN=T", attrs={})
        assert rec.get_all("missing") == []

    def test_to_dict_single_value(self):
        """to_dict() — однозначный атрибут становится строкой."""
        rec = LdifRecord(dn="CN=T", attrs={"cn": ["Test"]})
        d = rec.to_dict()
        assert d["cn"] == "Test"
        assert d["dn"] == "CN=T"

    def test_to_dict_multi_value(self):
        """to_dict() — многозначный атрибут становится списком."""
        rec = LdifRecord(dn="CN=T", attrs={"member": ["a", "b"]})
        d = rec.to_dict()
        assert d["member"] == ["a", "b"]

    def test_to_dict_without_dn(self):
        """to_dict(include_dn=False) — DN не включается."""
        rec = LdifRecord(dn="CN=T", attrs={"cn": ["Test"]})
        d = rec.to_dict(include_dn=False)
        assert "dn" not in d

    def test_flatten(self):
        """flatten() — все значения становятся строками."""
        rec = LdifRecord(dn="CN=T", attrs={"member": ["a", "b", "c"]})
        flat = rec.flatten()
        assert flat["member"] == "a; b; c"

    def test_repr(self):
        """repr() содержит DN и количество атрибутов."""
        rec = LdifRecord(dn="CN=T", attrs={"a": ["1"], "b": ["2"]})
        r = repr(rec)
        assert "CN=T" in r
        assert "2 keys" in r

    def test_equality(self):
        """Два одинаковых LdifRecord равны."""
        r1 = LdifRecord(dn="CN=T", attrs={"a": ["1"]})
        r2 = LdifRecord(dn="CN=T", attrs={"a": ["1"]})
        assert r1 == r2

    def test_inequality(self):
        """Разные LdifRecord не равны."""
        r1 = LdifRecord(dn="CN=A", attrs={"a": ["1"]})
        r2 = LdifRecord(dn="CN=B", attrs={"a": ["1"]})
        assert r1 != r2


class TestParseLdifFunctions:
    """Тесты функций-обёрток."""

    def test_parse_ldif_string(self):
        """parse_ldif_string() разбирает строку."""
        records = parse_ldif_string(SAMPLE_LDIF_SAM_USERS)
        assert len(records) == 7

    def test_parse_ldif_file(self):
        """parse_ldif_file() разбирает файл."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.ldif', delete=False, encoding='utf-8') as f:
            f.write(SAMPLE_LDIF_PRIVILEGE)
            f.flush()
            filepath = f.name

        try:
            records = parse_ldif_file(filepath)
            assert len(records) == 2
        finally:
            os.unlink(filepath)


class TestLdifParserEdgeCases:
    """Граничные случаи парсера LDIF."""

    def test_record_with_no_attrs(self):
        """Запись без атрибутов возвращает None."""
        parser = LdifParser()
        result = parser._parse_block([])
        assert result is None

    def test_record_with_only_dn(self):
        """Запись только с DN — валидна."""
        parser = LdifParser()
        result = parser._parse_block(["dn: CN=Test,DC=local"])
        assert result is not None
        assert result.dn == "CN=Test,DC=local"

    def test_strange_line_without_colon(self):
        """Строка без ':' пропускается."""
        parser = LdifParser()
        result = parser._parse_block(["dn: CN=Test", "weird line without colon"])
        assert result is not None
        assert len(result.attrs) == 0

    def test_distinguishedname_ignored(self):
        """Атрибут distinguishedName не дублирует DN."""
        parser = LdifParser()
        result = parser._parse_block([
            "dn: CN=Test,DC=local",
            "distinguishedName: CN=Test,DC=local",
        ])
        assert result is not None
        assert result.dn == "CN=Test,DC=local"
        assert "distinguishedName" not in result.attrs

    def test_unfold_lines(self):
        """Разворачивание перенесённых строк."""
        parser = LdifParser()
        lines = ["key: value1", " continuation", "key2: value2"]
        unfolded = parser._unfold_lines(lines)
        assert len(unfolded) == 2
        assert unfolded[0] == "key: value1continuation"
        assert unfolded[1] == "key2: value2"

    def test_split_into_blocks(self):
        """Разбивка на блоки по # record и пустым строкам."""
        parser = LdifParser()
        lines = [
            "# record 1",
            "dn: CN=A",
            "cn: A",
            "",
            "# record 2",
            "dn: CN=B",
            "cn: B",
        ]
        blocks = parser._split_into_blocks(lines)
        assert len(blocks) == 2

    def test_statistics_lines_ignored(self):
        """Строки статистики (# returned, # entries) игнорируются."""
        parser = LdifParser()
        lines = [
            "# record 1",
            "dn: CN=A",
            "cn: A",
            "# returned 1 records",
            "# 1 entries",
            "# 0 referrals",
        ]
        blocks = parser._split_into_blocks(lines)
        assert len(blocks) == 1
