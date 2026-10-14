"""Generate a clearly fictional original-document exercise for the manual CSV demo."""

from __future__ import annotations

import csv
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "가상_에이비정밀_별도재무_2023-2025_억원.csv"
OUTPUT = ROOT / "output" / "pdf" / "가상_에이비정밀_별도재무제표_2023-2025.pdf"

pdfmetrics.registerFont(TTFont("Malgun", "C:/Windows/Fonts/malgun.ttf"))
pdfmetrics.registerFont(TTFont("MalgunBold", "C:/Windows/Fonts/malgunbd.ttf"))

NAVY = colors.HexColor("#102A47")
BLUE = colors.HexColor("#1765D1")
LIGHT = colors.HexColor("#EEF4FB")
LINE = colors.HexColor("#D9E4EF")
MUTED = colors.HexColor("#53687E")
RED = colors.HexColor("#B7444A")

title = ParagraphStyle("title", fontName="MalgunBold", fontSize=25, leading=34, textColor=NAVY)
heading = ParagraphStyle("heading", fontName="MalgunBold", fontSize=16, leading=22, textColor=NAVY, spaceAfter=10)
subheading = ParagraphStyle("subheading", fontName="MalgunBold", fontSize=11.5, leading=17, textColor=NAVY, spaceAfter=7)
body = ParagraphStyle("body", fontName="Malgun", fontSize=10, leading=16, textColor=NAVY)
small = ParagraphStyle("small", fontName="Malgun", fontSize=8.7, leading=13, textColor=MUTED)
small_blue = ParagraphStyle("small-blue", parent=small, fontName="MalgunBold", textColor=BLUE)
tag = ParagraphStyle("tag", fontName="MalgunBold", fontSize=9, leading=14, textColor=BLUE)
right = ParagraphStyle("right", fontName="Malgun", fontSize=9.3, leading=14, alignment=TA_RIGHT, textColor=NAVY)
right_bold = ParagraphStyle("right-bold", parent=right, fontName="MalgunBold")
label = ParagraphStyle("label", fontName="Malgun", fontSize=9.3, leading=14, textColor=NAVY)
label_bold = ParagraphStyle("label-bold", parent=label, fontName="MalgunBold")


def p(text: str, style=body):
    return Paragraph(str(text), style)


def amount(value: int | float) -> str:
    return f"{value:,.0f}"


def load_records():
    with SOURCE.open(encoding="utf-8-sig", newline="") as stream:
        labels = [
            "연도", "매출액", "영업이익", "당기순이익", "매출원가", "영업활동현금흐름",
            "투자활동현금흐름", "재무활동현금흐름", "현금및현금성자산", "자산총계",
            "부채총계", "자본총계", "유동자산", "유동부채", "매출채권", "재고자산",
            "매입채무", "단기 금융차입금", "장기 금융차입금", "금융비용", "이자비용",
            "유형자산 취득", "무형자산 취득",
        ]
        keys = [
            "period", "revenue", "operatingProfit", "netIncome", "costOfSales", "operatingCashFlow",
            "investingCashFlow", "financingCashFlow", "cash", "totalAssets", "totalLiabilities",
            "equity", "currentAssets", "currentLiabilities", "accountsReceivable", "inventory",
            "accountsPayable", "shortTermDebt", "longTermDebt", "financeCosts", "interestExpense",
            "capex", "intangibleCapex",
        ]
        reader = csv.DictReader(stream)
        if reader.fieldnames != labels:
            raise ValueError("가상 CSV의 한글 계정명이 PDF 생성기의 기대 순서와 다릅니다.")
        rows = [{key: row[label] for key, label in zip(keys, labels)} for row in reader]
    if [row["period"] for row in rows] != ["2023", "2024", "2025"]:
        raise ValueError("Expected 2023-2025 sample data")
    records = [{key: int(value) if key != "period" and value else value for key, value in row.items()} for row in rows]
    # The customer-input CSV deliberately carries a 2025 current-asset transcription error.
    # This PDF is the fictional source document against which the reviewer corrects it.
    records[-1]["currentAssets"] = 230
    for row in records:
        if row["totalAssets"] != row["totalLiabilities"] + row["equity"]:
            raise ValueError("Balance sheet does not reconcile")
        if row["currentAssets"] < row["cash"] + row["accountsReceivable"] + row["inventory"]:
            raise ValueError("Current asset components exceed current assets")
        if row["currentLiabilities"] < row["accountsPayable"] + row["shortTermDebt"]:
            raise ValueError("Current liability components exceed current liabilities")
    for previous, current in zip(records, records[1:]):
        change = current["operatingCashFlow"] + current["investingCashFlow"] + current["financingCashFlow"]
        if current["cash"] - previous["cash"] != change:
            raise ValueError("Cash-flow bridge does not reconcile")
    return records


def table(rows, widths=(74 * mm, 30 * mm, 30 * mm, 30 * mm), bold_rows=(), shade_rows=()):
    contents = []
    for index, row in enumerate(rows):
        contents.append([p(row[0], label_bold if index in bold_rows or index == 0 else label)] + [p(value, right_bold if index in bold_rows or index == 0 else right) for value in row[1:]])
    result = Table(contents, colWidths=widths, repeatRows=1, hAlign="LEFT")
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
        ("LINEBELOW", (0, 0), (-1, -1), 0.35, LINE),
    ]
    for index in shade_rows:
        commands.append(("BACKGROUND", (0, index), (-1, index), colors.HexColor("#F8FBFE")))
    for index in bold_rows:
        commands.append(("LINEABOVE", (0, index), (-1, index), 0.8, LINE))
    result.setStyle(TableStyle(commands))
    return result


def statement_rows(records, specifications):
    return [["계정 (단위: 억원)", "2023", "2024", "2025"]] + [
        [label_text, *[amount(formula(row)) for row in records]] for label_text, formula in specifications
    ]


def page(canvas, doc):
    canvas.saveState()
    width, height = doc.pagesize
    canvas.setStrokeColor(LINE)
    canvas.line(19 * mm, height - 19 * mm, width - 19 * mm, height - 19 * mm)
    canvas.setFont("MalgunBold", 9)
    canvas.setFillColor(NAVY)
    canvas.drawString(19 * mm, height - 15.5 * mm, "가상기업 에이비정밀 | 별도재무제표 예시")
    canvas.setFillColor(MUTED)
    canvas.setFont("Malgun", 8)
    canvas.drawString(19 * mm, 15 * mm, "교육용 가상자료 · 실제 기업/감사보고서가 아닙니다")
    canvas.drawRightString(width - 19 * mm, 15 * mm, f"{doc.page}")
    canvas.restoreState()


def build():
    records = load_records()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    document = BaseDocTemplate(str(OUTPUT), pagesize=(210 * mm, 297 * mm), leftMargin=19 * mm, rightMargin=19 * mm, topMargin=28 * mm, bottomMargin=23 * mm, title="가상기업 에이비정밀 별도재무제표 예시", author="CreditLens 교육용")
    frame = Frame(19 * mm, 23 * mm, 172 * mm, 246 * mm, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    document.addPageTemplates(PageTemplate(id="all", frames=[frame], onPage=page))
    story = []

    story += [Spacer(1, 22 * mm), p("CREDITLENS / FICTIONAL SOURCE DOCUMENT", tag), Spacer(1, 7 * mm), p("가상기업 에이비정밀<br/>별도재무제표 예시", title), Spacer(1, 8 * mm), p("2023-2025 회계연도 · 금액 단위 억원", body), Spacer(1, 16 * mm)]
    cover_details = Table([
        [p("문서 성격", label_bold), p("교육용 가상 재무자료", label)],
        [p("회계 범위", label_bold), p("차주 법인 별도", label)],
        [p("표시 기준", label_bold), p("일반기업회계기준(가정)", label)],
        [p("외부감사", label_bold), p("미실시 · 감사의견 없음", label)],
    ], colWidths=(41 * mm, 123 * mm))
    cover_details.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), LIGHT), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8), ("LINEBELOW", (0, 0), (-1, -1), 0.5, LINE)]))
    story += [cover_details, Spacer(1, 13 * mm)]
    story += [p("이 문서는 CreditLens의 고객 제출자료 대조 절차를 연습하기 위한 가상 원본입니다. 실제 법인, 회계사, 감사보고서, 금융기관의 검증을 나타내지 않습니다.", body), Spacer(1, 7 * mm), p("읽는 순서", subheading), p("2쪽 재무상태표 → 3쪽 손익계산서 → 4쪽 현금흐름표 → 5쪽 주요 주석. 플랫폼의 CSV 입력값은 해당 페이지의 계정·기간·단위와 직접 비교해 확인합니다.", body), Spacer(1, 7 * mm), p("원본 대조는 사람이 기록하는 절차입니다. PDF 첨부나 파일 해시만으로 수치, 감사의견 또는 문서의 진위가 검증되지는 않습니다.", small)]
    story.append(PageBreak())

    story += [p("01 / STATEMENT OF FINANCIAL POSITION", tag), Spacer(1, 4 * mm), p("재무상태표", heading), p("각 회계연도 말 잔액 · 별도 기준", small), Spacer(1, 5 * mm)]
    balance_spec = [
        ("유동자산", lambda r: r["currentAssets"]),
        ("  현금및현금성자산", lambda r: r["cash"]),
        ("  매출채권", lambda r: r["accountsReceivable"]),
        ("  재고자산", lambda r: r["inventory"]),
        ("  기타 유동자산", lambda r: r["currentAssets"] - r["cash"] - r["accountsReceivable"] - r["inventory"]),
        ("비유동자산", lambda r: r["totalAssets"] - r["currentAssets"]),
        ("자산총계", lambda r: r["totalAssets"]),
        ("유동부채", lambda r: r["currentLiabilities"]),
        ("  매입채무", lambda r: r["accountsPayable"]),
        ("  단기차입금", lambda r: r["shortTermDebt"]),
        ("  기타 유동부채", lambda r: r["currentLiabilities"] - r["accountsPayable"] - r["shortTermDebt"]),
        ("비유동부채", lambda r: r["totalLiabilities"] - r["currentLiabilities"]),
        ("부채총계", lambda r: r["totalLiabilities"]),
        ("자본총계", lambda r: r["equity"]),
        ("부채와 자본총계", lambda r: r["totalLiabilities"] + r["equity"]),
    ]
    story += [table(statement_rows(records, balance_spec), bold_rows=(1, 6, 7, 8, 12, 13, 14, 15), shade_rows=(7, 13, 15)), Spacer(1, 5 * mm), p("대조 위치: CSV의 totalAssets, totalLiabilities, equity, currentAssets 및 주요 유동계정. 구성계정의 합계와 유동자산·유동부채 소계를 함께 확인합니다.", small)]
    story.append(PageBreak())

    story += [p("02 / INCOME STATEMENT", tag), Spacer(1, 4 * mm), p("손익계산서", heading), p("각 회계연도 연간 누적 실적 · 별도 기준", small), Spacer(1, 5 * mm)]
    income_spec = [
        ("매출액", lambda r: r["revenue"]),
        ("매출원가", lambda r: -r["costOfSales"]),
        ("매출총이익", lambda r: r["revenue"] - r["costOfSales"]),
        ("판매비와관리비", lambda r: -(r["revenue"] - r["costOfSales"] - r["operatingProfit"])),
        ("영업이익", lambda r: r["operatingProfit"]),
        ("금융비용", lambda r: -r["financeCosts"]),
        ("기타손익·법인세비용 순액", lambda r: r["netIncome"] - r["operatingProfit"] + r["financeCosts"]),
        ("당기순이익", lambda r: r["netIncome"]),
    ]
    story += [table(statement_rows(records, income_spec), bold_rows=(1, 3, 5, 8), shade_rows=(5, 8)), Spacer(1, 8 * mm), p("금융비용 중 이자비용은 각각 2023년 5억원, 2024년 6억원, 2025년 8억원입니다. 플랫폼의 영업이익/금융비용과 순수 이자비용 배율은 다른 지표입니다.", body)]
    story.append(PageBreak())

    story += [p("03 / CASH FLOW STATEMENT", tag), Spacer(1, 4 * mm), p("현금흐름표", heading), p("각 회계연도 연간 누적 실적 · 별도 기준", small), Spacer(1, 5 * mm)]
    cash_spec = [
        ("기초 현금및현금성자산", lambda r: r["cash"] - r["operatingCashFlow"] - r["investingCashFlow"] - r["financingCashFlow"]),
        ("영업활동현금흐름", lambda r: r["operatingCashFlow"]),
        ("투자활동현금흐름", lambda r: r["investingCashFlow"]),
        ("  유형자산 취득", lambda r: -r["capex"]),
        ("  무형자산 취득", lambda r: -r["intangibleCapex"]),
        ("재무활동현금흐름", lambda r: r["financingCashFlow"]),
        ("세 활동 현금흐름 합계", lambda r: r["operatingCashFlow"] + r["investingCashFlow"] + r["financingCashFlow"]),
        ("기말 현금및현금성자산", lambda r: r["cash"]),
    ]
    story += [table(statement_rows(records, cash_spec), bold_rows=(2, 3, 6, 7, 8), shade_rows=(7, 8)), Spacer(1, 8 * mm), p("현금 증감 = 영업 + 투자 + 재무활동 현금흐름. 이 예시는 환율효과 등 추가 조정항목을 두지 않았습니다. 2025년 투자활동 유출 25억원은 유형·무형자산 취득 23억원과 2억원으로 구성됩니다.", body)]
    story.append(PageBreak())

    story += [p("04 / NOTES", tag), Spacer(1, 4 * mm), p("주요 계정 주석", heading), p("차입구조와 운전자본 계정의 교육용 보충설명", small), Spacer(1, 5 * mm)]
    note_spec = [
        ("단기차입금", lambda r: r["shortTermDebt"]),
        ("장기차입 계약잔액", lambda r: r["longTermDebt"]),
        ("차입금 합계 (리스 제외)", lambda r: r["shortTermDebt"] + r["longTermDebt"]),
        ("금융비용", lambda r: r["financeCosts"]),
        ("금융비용 중 이자비용", lambda r: r["interestExpense"]),
        ("매출채권", lambda r: r["accountsReceivable"]),
        ("재고자산", lambda r: r["inventory"]),
        ("매입채무", lambda r: r["accountsPayable"]),
    ]
    story += [table(statement_rows(records, note_spec), bold_rows=(3, 4, 5)), Spacer(1, 9 * mm), p("주석 1. 회계기준과 범위", subheading), p("별도재무제표이며 일반기업회계기준을 적용했다고 가정합니다. 연결재무제표, 종속회사, 관계회사 지원 여부는 이 문서에 포함하지 않았습니다.", body), Spacer(1, 7 * mm), p("주석 2. 차입금", subheading), p("장기차입 계약잔액에는 유동성 대체분이 2023년과 2024년에 각각 5억원 포함된 것으로 가정합니다. 따라서 유동/비유동 부채 소계만으로 차입만기 구조를 확정할 수 없습니다. 실제 만기일·담보·보증·금리유형 정보는 이 교육용 자료에 없습니다.", body), Spacer(1, 7 * mm), p("주석 3. 감사·증빙 범위", subheading), p("이 자료는 외부감사를 받지 않은 가상 예시입니다. 감사의견, 회계법인명, 서명, 실제 계약서와 원장 증빙을 포함하지 않습니다. CreditLens에서 원문 대조 여부를 기록하더라도 문서의 진위가 자동 확인되는 것은 아닙니다.", body)]
    document.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    build()
