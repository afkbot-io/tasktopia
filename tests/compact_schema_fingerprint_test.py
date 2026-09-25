"""PostgreSQL deparses BETWEEN as nested AND, then flattens it on restore."""
import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'deploy'))
from compact_cutover_database import canonical_schema

class SchemaFingerprintTests(unittest.TestCase):
    def test_restore_preserves_nested_check_conjunction(self):
        before=b"ALTER TABLE countries ADD CHECK (CASE WHEN kind = 'number' THEN ((x >= 0 AND x <= 1000000) AND trunc(x) = x) ELSE false END);"
        after=b"ALTER TABLE countries ADD CHECK (CASE WHEN kind = 'number' THEN (x >= 0 AND x <= 1000000 AND trunc(x) = x) ELSE false END);"
        self.assertEqual(canonical_schema(before),canonical_schema(after))
        self.assertNotEqual(canonical_schema(before),canonical_schema(after.replace(b'1000000',b'1000001')))

    def test_preserves_boolean_precedence_casts_literals_and_bodies(self):
        pairs=[
          (b'CHECK ((a OR b) AND c)',b'CHECK (a OR b AND c)'),
          (b'CHECK (NOT (a AND b) AND c)',b'CHECK (NOT a AND b AND c)'),
          (b'CHECK ((a AND b)::int = 1 AND c)',b'CHECK (a AND b::int = 1 AND c)'),
          (b"CHECK (x = '(a AND b)' AND c)",b"CHECK (x = 'a AND b' AND c)"),
          (b'CHECK (x BETWEEN (a AND b) AND c)',b'CHECK (x BETWEEN a AND b AND c)'),
          (b'AS $$ SELECT ((a AND b) AND c) $$',b'AS $$ SELECT (a AND b AND c) $$'),
          (b'CHECK ("AND" = 1)',b'CHECK ("AND" = 2)'),
          (b'CHECK (a || b)',b'CHECK (a | | b)'),
          (b'CHECK (x = 12)',b'CHECK (x = 1 2)'),
        ]
        for a,b in pairs:
            with self.subTest(a=a): self.assertNotEqual(canonical_schema(a),canonical_schema(b))

    def test_random_psql_keys_are_not_schema(self):
        self.assertEqual(canonical_schema(b'\\restrict abc\nCHECK (a AND b);\n\\unrestrict abc'),canonical_schema(b'\\restrict def\nCHECK (a AND b);\n\\unrestrict def'))

if __name__=='__main__':unittest.main()
