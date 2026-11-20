# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                  | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.20: comprehensive automated QA suite for pure-stdlib OOXML executive resume pipeline (all 4 families, .dotx, blank templates, cover letters, zero theme-font leaks, Quick Styles, ATS/RTF primitives, exact headline parity across DOCX/RTF/PDF, automatic <=2-page compaction guard, python-docx round-trip, and zero-PII enforcement).
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.68.21: add unit coverage for _soffice_cmd() /usr/bin/sh fallback when /bin/sh is absent (bwrap sandbox without /bin) while keeping direct invocation when /bin/sh exists or for non-script binaries.
"""Automated QA checks for jobhunter.docx_ooxml and jobhunter.docx_resume."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

ENGINE_DIR = Path(__file__).resolve().parent.parent / "engine"
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

from jobhunter import docx_ooxml, docx_resume  # noqa: E402

REQUIRED_STYLE_IDS = (
    "Normal", "Title", "ResumeHeadline", "ResumeContact", "ResumeContactLast",
    "Heading1", "ResumeRole", "ResumeEmployer", "ResumeBullet",
    "ResumeSkills", "ResumeEarlier", "Footer",
)


def _synthetic_contact() -> dict:
    return {
        "name": "Jordan Rivera, BS Computer Science; MBA",
        "credential": "PMP",
        "location": "Austin, TX",
        "phone": "(512) 555-0148",
        "email": "jordan.rivera@example.test",
        "linkedin": "linkedin.com/in/jordanrivera",
        "citizenship": "U.S. Citizen",
        "clearance": "Public Trust",
    }


def _synthetic_resume(headline: str = "Principal Platform Architect | Cloud & Reliability Engineering", dense: bool = False) -> dict:
    roles = [
        {
            "id": "r-1",
            "title": "Principal Systems Architect",
            "org": "Harbor Cloud Systems",
            "span": "Jan 2023 to Present",
            "bullets": [
                "Led platform reliability engineering across 18 microservices supporting 12 million daily transactions with 99.99% uptime.",
                "Architected zero-downtime Kubernetes deployment pipelines reducing release lead time by 64% across 4 engineering orgs.",
                "Directed cross-functional incident command and automated runbooks cutting mean time to resolve by 52%.",
            ],
        },
        {
            "id": "r-2",
            "parent_role_id": "r-1",
            "group_heading": "Selected Client Engagements",
            "title": "Lead Reliability Advisor",
            "org": "Meridian Financial Client",
            "span": "Mar 2024 to Nov 2025",
            "bullets": [
                "Modernized core settlement APIs with strict schema contracts and automated canary verification.",
                "Delivered compliance-ready observability dashboards covering latency SLOs and audit trails.",
            ],
        },
        {
            "id": "r-3",
            "title": "Staff Software Engineer",
            "org": "Northwind Logistics",
            "span": "May 2019 to Dec 2022",
            "bullets": [
                "Built distributed event-streaming pipelines processing 400,000 shipment updates per hour in Python and Java.",
                "Mentored 12 engineers on API security, structured logging, and automated integration testing.",
                "Reduced cloud compute expenditure by $1.8M annually through rightsizing and workload consolidation.",
            ],
        },
        {
            "id": "r-4",
            "title": "Senior Backend Engineer",
            "org": "Cascade Telemetry",
            "span": "Jun 2015 to Apr 2019",
            "bullets": [
                "Designed multi-tenant PostgreSQL partitioning and row-level isolation for 250 enterprise accounts.",
                "Engineered automated schema migration checks preventing backward-incompatible deploys.",
            ],
        },
    ]
    if dense:
        for i in range(5, 11):
            roles.append({
                "id": f"r-{i}",
                "title": f"Senior Systems & Reliability Engineer {i}",
                "org": f"Enterprise Infrastructure Partner {i}",
                "span": f"Jan {2015 - i} to Dec {2016 - i}",
                "bullets": [
                    f"Delivered large-scale distributed infrastructure modernization program {i} across regional data centers with strict availability, security auditing, and automated failover verification.",
                    f"Coordinated multi-team release governance, automated configuration management, and database reliability testing for mission-critical enterprise workloads in cycle {i}.",
                    f"Established telemetry standards, capacity modeling, and executive operational reviews sustaining 99.95% service availability across regulated production environments in phase {i}.",
                ],
            })
    return {
        "headline": headline,
        "summary": "Executive technology leader with 15 years of experience architecting secure cloud platforms, leading reliability engineering organizations, and shipping resilient enterprise software.",
        "competencies": ["Cloud Architecture", "Site Reliability Engineering", "Platform Security", "Distributed Systems", "CI/CD Automation", "Executive Delivery"],
        "skills": [
            "Cloud & Infrastructure: AWS, Kubernetes, Terraform, Linux, Docker, GitHub Actions",
            "Languages & Data: Python, Java, TypeScript, SQL, PostgreSQL, Redis, Kafka",
            "Reliability & Security: SLOs, OpenTelemetry, Zero-Trust IAM, Incident Command",
        ],
        "experience": roles,
        "additional_experience": [
            {
                "title": "Open Telemetry Toolkit",
                "org": "Independent Open Source | example.test",
                "span": "2022 to Present",
                "bullets": [
                    "Published lightweight Python tracing adapters and schema validators adopted by internal developer teams.",
                ],
            }
        ],
        "education": [
            "MBA, Technology Management | State University | 2013 - 2015",
            "BS, Computer Science | Regional Tech Institute | 2007 - 2011",
        ],
        "certifications": ["AWS Solutions Architect Professional", "Certified Kubernetes Administrator"],
        "clearance": "Public Trust",
    }


def _synthetic_cover() -> dict:
    return {
        "greeting": "Dear Hiring Manager,",
        "paragraphs": [
            "Leading secure cloud architecture and reliability delivery at Harbor Cloud Systems aligns closely with your platform engineering mandate.",
            "My teams delivered 99.99% availability across 18 core services while cutting release lead times by 64% through automated deployment gates.",
            "I welcome the opportunity to discuss how this experience can accelerate your platform roadmap.",
        ],
        "closing": "Sincerely,",
    }


class TestDocxResumePipeline(unittest.TestCase):
    def _assert_ooxml_invariants(self, docx_path: Path, expected_font: str) -> tuple[str, str]:
        with ZipFile(docx_path) as zf:
            styles_xml = zf.read("word/styles.xml").decode("utf-8")
            doc_xml = zf.read("word/document.xml").decode("utf-8")
            footer_xml = zf.read("word/footer1.xml").decode("utf-8")
            num_xml = zf.read("word/numbering.xml").decode("utf-8")
        for label, xml in (("styles.xml", styles_xml), ("document.xml", doc_xml), ("footer1.xml", footer_xml)):
            for bad in ("asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"):
                self.assertNotIn(bad, xml, f"{docx_path.name} {label} leaked {bad}")
        for sid in REQUIRED_STYLE_IDS:
            m = re.search(rf'<w:style[^>]*w:styleId="{sid}"[^>]*>(.*?)</w:style>', styles_xml, re.S)
            self.assertIsNotNone(m, f"missing style {sid}")
            self.assertIn("<w:qFormat", m.group(1), f"style {sid} missing qFormat")
            self.assertIn(f'w:ascii="{expected_font}"', m.group(1), f"style {sid} missing explicit font")
        self.assertNotIn("<w:tbl", doc_xml)
        self.assertNotIn("txbxContent", doc_xml)
        self.assertNotIn("pageBreakBefore", doc_xml)
        self.assertNotIn("Continued", doc_xml)
        self.assertIn(" PAGE ", footer_xml)
        self.assertIn('w:abstractNumId="80"', num_xml)
        try:
            from docx import Document
            doc = Document(docx_path)
            self.assertGreater(len(doc.paragraphs), 8)
        except ImportError:
            pass
        return doc_xml, styles_xml

    def test_all_four_families_templates_dotx_and_cover(self) -> None:
        with tempfile.TemporaryDirectory(prefix="career-docx-fam-") as td:
            out = Path(td)
            for fam in docx_resume.VALID_FAMILIES:
                expected_font = docx_ooxml.FAMILIES[fam]["font"]
                tpl = docx_resume.render_blank_template(fam, out / f"{fam}_tpl.docx", also_dotx=True)
                self.assertTrue(tpl.is_file())
                dotx = tpl.with_suffix(".dotx")
                self.assertTrue(dotx.is_file())
                with ZipFile(dotx) as zf:
                    ct = zf.read("[Content_Types].xml").decode("utf-8")
                    self.assertIn("wordprocessingml.template.main+xml", ct)
                doc_xml, styles_xml = self._assert_ooxml_invariants(tpl, expected_font)
                self.assertIn("[Full Name]", doc_xml)
                if fam == "Technical":
                    self.assertIn('w:fill="EDF4F7"', styles_xml)
                if fam == "Leadership":
                    self.assertIn('w:val="center"', styles_xml)
                cov = docx_resume.render_cover_docx(
                    _synthetic_contact(), _synthetic_cover(), "Example Corp", "Principal Architect",
                    "November 19, 2026", out / f"{fam}_cover.docx", family=fam,
                )
                cov_xml, _ = self._assert_ooxml_invariants(cov, expected_font)
                self.assertIn("Jordan Rivera", cov_xml)
                self.assertNotIn("Jordan Rivera, BS", cov_xml)
                self.assertIn("Example Corp", cov_xml)

    def test_family_auto_selection_and_clean_name(self) -> None:
        self.assertEqual(docx_resume.choose_family("VP of Engineering"), "Leadership")
        self.assertEqual(docx_resume.choose_family("Staff Software Engineer"), "Technical")
        self.assertEqual(docx_resume.choose_family("Technical Program Manager"), "Standard")
        self.assertEqual(docx_resume.choose_family("Operations Lead"), "Professional")
        self.assertEqual(docx_resume.choose_family("Staff Software Engineer", requested="Leadership"), "Leadership")
        self.assertEqual(docx_resume.clean_candidate_name("Jordan Rivera, BS Computer Science; MBA"), "Jordan Rivera")
        self.assertEqual(docx_resume.clean_candidate_name("Alex Morgan, PMP"), "Alex Morgan")

    def test_exact_headline_parity_and_2page_compaction_guard(self) -> None:
        soffice = shutil.which("soffice") or shutil.which("libreoffice")
        self.assertIsNotNone(soffice, "LibreOffice soffice is required for PDF/RTF parity verification")
        headline = "Principal SRE & Cloud Architect | Mission-Critical Distributed Platforms"
        with tempfile.TemporaryDirectory(prefix="career-docx-parity-") as td:
            out = Path(td)
            res = docx_resume.build_packet_docx_artifacts(
                out, _synthetic_contact(), _synthetic_resume(headline=headline, dense=True),
                _synthetic_cover(), "Orbit Federal", "Staff Cloud Engineer", "November 19, 2026",
            )
            self.assertEqual(res["family"], "Technical")
            self.assertTrue(res["soffice_used"])
            self.assertLessEqual(res["pages"], 2, f"dense resume must compact to <= 2 pages, got {res['pages']}")
            self.assertGreaterEqual(res["tier"], 1, "dense resume should engage compaction guard")

            docx_path = Path(res["resume_docx"])
            rtf_path = Path(res["resume_rtf"])
            pdf_path = Path(res["resume_pdf"])
            self.assertTrue(docx_path.is_file() and rtf_path.is_file() and pdf_path.is_file())
            self.assertLessEqual(docx_resume.pdf_page_count(pdf_path), 2)

            doc_xml, _ = self._assert_ooxml_invariants(docx_path, "Calibri")
            decoded_xml = doc_xml.replace("&amp;", "&")
            self.assertIn(headline, decoded_xml)
            self.assertIn("Jordan Rivera", decoded_xml)
            self.assertNotIn("Jordan Rivera, BS", decoded_xml)
            self.assertNotIn("Jordan Rivera, PMP", decoded_xml)

            rtf_text = rtf_path.read_text(encoding="latin-1", errors="replace")
            self.assertTrue(rtf_text.startswith("{\\rtf1"))
            self.assertIn("Principal SRE", rtf_text)
            self.assertIn("Jordan Rivera", rtf_text)

            pdftotext = shutil.which("pdftotext")
            if pdftotext:
                pdf_txt = subprocess.check_output([pdftotext, str(pdf_path), "-"], text=True)
                collapsed = re.sub(r"\s+", " ", pdf_txt)
                self.assertIn(headline, collapsed)
                self.assertIn("Jordan Rivera", collapsed)
                self.assertNotIn("Jordan Rivera, BS", collapsed)

    def test_zero_pii_in_engine_docx_modules_and_templates(self) -> None:
        targets = [
            ENGINE_DIR / "jobhunter" / "docx_ooxml.py",
            ENGINE_DIR / "jobhunter" / "docx_resume.py",
            ENGINE_DIR / "jobhunter" / "templates" / "resume.html",
            ENGINE_DIR / "jobhunter" / "templates" / "resume_premium.html",
            ENGINE_DIR / "jobhunter" / "templates" / "resume_1page.html",
            ENGINE_DIR / "jobhunter" / "templates" / "cover.html",
        ]
        forbidden_patterns = (
            r"@gmail\.com",
            r"@yahoo\.com",
            r"@hotmail\.com",
            r"\(\d{3}\)\s*\d{3}-\d{4}",
            r"linkedin\.com/in/[a-z0-9]",
            r"/home/[a-z]",
            r"C:/Users/",
        )
        for fp in targets:
            content = fp.read_text(encoding="utf-8")
            for pat in forbidden_patterns:
                self.assertIsNone(re.search(pat, content, re.I), f"PII pattern {pat!r} found in {fp.name}")

    def test_soffice_cmd_bwrap_usr_bin_sh_fallback(self) -> None:
        args = ["--headless", "--convert-to", "pdf", "Resume_ATS.docx"]
        with tempfile.TemporaryDirectory(prefix="career-soffice-cmd-") as td:
            wrapper = Path(td) / "soffice"
            wrapper.write_text("#!/bin/sh\nexec oosplash \"$@\"\n", encoding="utf-8")
            elf_bin = Path(td) / "soffice.bin"
            elf_bin.write_bytes(b"\x7fELF\x02\x01\x01\x00binary")
            fake_sh = Path(td) / "usr-bin-sh"
            fake_sh.write_bytes(b"\x7fELF")

            self.assertEqual(
                docx_resume._soffice_cmd(str(wrapper), args, bin_sh_exists=False, usr_bin_sh=str(fake_sh)),
                [str(fake_sh), str(wrapper), *args],
            )
            self.assertEqual(
                docx_resume._soffice_cmd(str(wrapper), args, bin_sh_exists=True, usr_bin_sh=str(fake_sh)),
                [str(wrapper), *args],
            )
            self.assertEqual(
                docx_resume._soffice_cmd(str(elf_bin), args, bin_sh_exists=False, usr_bin_sh=str(fake_sh)),
                [str(elf_bin), *args],
            )
            real_soffice = shutil.which("soffice") or shutil.which("libreoffice")
            if real_soffice and os.path.exists("/usr/bin/sh") and docx_resume._is_shell_wrapper(real_soffice):
                self.assertEqual(
                    docx_resume._soffice_cmd(real_soffice, args, bin_sh_exists=False),
                    ["/usr/bin/sh", real_soffice, *args],
                )


if __name__ == "__main__":
    unittest.main(verbosity=2)
