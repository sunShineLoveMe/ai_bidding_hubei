import unittest
from unittest.mock import patch

from backend.ai.compliance_checker import build_compliance_report


class ComplianceCheckerRegressionTest(unittest.TestCase):
    def test_generated_content_increases_requirement_coverage(self):
        payload = {
            "project": {"project_name": "测试水库工程"},
            "requirements": [
                {
                    "id": "req-1",
                    "content": "投标人须提供安全生产许可证和水利水电工程施工资质证书。",
                    "requirement_type": "qualification",
                    "priority": "high",
                }
            ],
            "scoringItems": [],
            "risks": [],
            "sections": [
                {
                    "id": "section-1",
                    "title": "资格审查资料",
                    "level": 1,
                    "content": "投标人须提供安全生产许可证和水利水电工程施工资质证书。我方已提供安全生产许可证，并附水利水电工程施工资质证书复印件，确保资格审查资料完整、真实、有效，满足招标文件资格审查要求。",
                    "mapped_requirements": [],
                    "metadata": {"volume_type": "qualification"},
                }
            ],
        }

        with patch("backend.ai.compliance_checker.get_project_interpretation", return_value=payload):
            report = build_compliance_report("project-smoke")

        self.assertEqual(report["summary"]["total"], 1)
        self.assertEqual(report["summary"]["covered"], 1)
        self.assertEqual(report["summary"]["missing"], 0)
        self.assertEqual(report["summary"]["percent"], 100)

    def test_missing_high_risk_item_is_reported(self):
        payload = {
            "project": {"project_name": "测试水库工程"},
            "requirements": [],
            "scoringItems": [],
            "risks": [
                {
                    "id": "risk-1",
                    "content": "未按招标文件要求缴纳投标保证金将被否决投标。",
                    "risk_level": "high",
                    "risk_type": "否决",
                }
            ],
            "sections": [
                {
                    "id": "section-1",
                    "title": "施工组织设计",
                    "level": 1,
                    "content": "本章说明施工组织、质量安全和进度计划。",
                    "metadata": {"volume_type": "technical"},
                }
            ],
        }

        with patch("backend.ai.compliance_checker.get_project_interpretation", return_value=payload):
            report = build_compliance_report("project-smoke")

        self.assertEqual(report["summary"]["missing"], 1)
        self.assertEqual(report["summary"]["highRiskMissing"], 1)
        self.assertEqual(report["rows"][0]["status"], "missing")


if __name__ == "__main__":
    unittest.main()
