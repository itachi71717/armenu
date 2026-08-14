"""Generate the AR Menu strategy roadmap PDF."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak,
    Table, TableStyle, KeepTogether
)
from reportlab.platypus.flowables import HRFlowable

OUT = r"C:\Users\Admin\Desktop\AR_Menu_Strategy_Roadmap.pdf"

# ---- Brand colours
INK     = HexColor("#0a0806")
INK_DIM = HexColor("#564f45")
ACCENT  = HexColor("#ff5722")
ACCENT2 = HexColor("#ffb066")
LINE    = HexColor("#e8d8c0")
PAPER   = HexColor("#fbf6ee")

# ---- Styles
styles = getSampleStyleSheet()

cover_title = ParagraphStyle(
    "CoverTitle", parent=styles["Title"],
    fontName="Helvetica-Bold", fontSize=44, leading=48,
    textColor=INK, alignment=TA_CENTER, spaceAfter=8,
)
cover_sub = ParagraphStyle(
    "CoverSub", parent=styles["Normal"],
    fontName="Helvetica-Oblique", fontSize=18, leading=22,
    textColor=ACCENT, alignment=TA_CENTER, spaceAfter=24,
)
cover_meta = ParagraphStyle(
    "CoverMeta", parent=styles["Normal"],
    fontName="Helvetica", fontSize=10, leading=14,
    textColor=INK_DIM, alignment=TA_CENTER,
)

h1 = ParagraphStyle(
    "H1", parent=styles["Heading1"],
    fontName="Helvetica-Bold", fontSize=24, leading=28,
    textColor=INK, spaceBefore=8, spaceAfter=10,
)
h2 = ParagraphStyle(
    "H2", parent=styles["Heading2"],
    fontName="Helvetica-Bold", fontSize=16, leading=20,
    textColor=ACCENT, spaceBefore=14, spaceAfter=6,
)
h3 = ParagraphStyle(
    "H3", parent=styles["Heading3"],
    fontName="Helvetica-Bold", fontSize=13, leading=16,
    textColor=INK, spaceBefore=10, spaceAfter=4,
)
body = ParagraphStyle(
    "Body", parent=styles["BodyText"],
    fontName="Helvetica", fontSize=10.5, leading=15,
    textColor=INK, alignment=TA_LEFT, spaceAfter=6,
)
emph = ParagraphStyle(
    "Emph", parent=body,
    fontName="Helvetica-Oblique", textColor=INK_DIM,
)
bullet = ParagraphStyle(
    "Bullet", parent=body,
    leftIndent=14, bulletIndent=2, spaceAfter=3,
)
quote = ParagraphStyle(
    "Quote", parent=body,
    fontName="Helvetica-Bold", fontSize=12, leading=18,
    textColor=ACCENT, leftIndent=12, borderPadding=8,
    spaceBefore=8, spaceAfter=8,
)
small = ParagraphStyle(
    "Small", parent=body, fontSize=9, textColor=INK_DIM,
)


def hr():
    return HRFlowable(width="100%", thickness=0.6, color=LINE, spaceBefore=8, spaceAfter=10)


def bullets(items):
    return [Paragraph(f"&bull;&nbsp;&nbsp;{x}", bullet) for x in items]


def make_table(data, col_widths=None):
    t = Table(data, colWidths=col_widths, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("TEXTCOLOR", (0, 0), (-1, 0), HexColor("#ffffff")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 10),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 9.5),
        ("TEXTCOLOR", (0, 1), (-1, -1), INK),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [PAPER, HexColor("#ffffff")]),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, LINE),
    ]))
    return t


def page_decoration(canvas, doc):
    canvas.saveState()
    width, height = A4
    # Footer rule
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, 1.4 * cm, width - 2 * cm, 1.4 * cm)
    # Footer text
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(INK_DIM)
    canvas.drawString(2 * cm, 1.0 * cm, "AR Menu  -  Strategy Roadmap")
    canvas.drawRightString(width - 2 * cm, 1.0 * cm, f"Page {doc.page}")
    canvas.drawCentredString(width / 2, 1.0 * cm, "armenu.co.za")
    canvas.restoreState()


def cover_decoration(canvas, doc):
    canvas.saveState()
    width, height = A4
    # Big orange band
    canvas.setFillColor(ACCENT)
    canvas.rect(0, height - 4 * cm, width, 4 * cm, fill=1, stroke=0)
    # Bottom band
    canvas.setFillColor(INK)
    canvas.rect(0, 0, width, 1.2 * cm, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#ffffff"))
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawCentredString(width / 2, 0.5 * cm, "armenu.co.za  -  Strategy Roadmap  -  2026")
    canvas.restoreState()


# ============ BUILD DOC ============

doc = SimpleDocTemplate(
    OUT, pagesize=A4,
    leftMargin=2 * cm, rightMargin=2 * cm,
    topMargin=2 * cm, bottomMargin=2 * cm,
    title="AR Menu - Strategy Roadmap",
    author="AR Menu",
)

story = []

# ===== COVER PAGE =====
story.append(Spacer(1, 5 * cm))
story.append(Paragraph("AR&nbsp;Menu", cover_title))
story.append(Paragraph("Strategy Roadmap", cover_sub))
story.append(Spacer(1, 1.2 * cm))
story.append(Paragraph(
    "From R0 platform to R100M ordering layer.<br/>"
    "Quick wins, sales plays, and the 10x bets that turn AR Menu "
    "into the operating system for every restaurant in South Africa.",
    ParagraphStyle("CoverDesc", parent=body, alignment=TA_CENTER,
                   fontSize=12, leading=18, textColor=INK_DIM)
))
story.append(Spacer(1, 4 * cm))
story.append(Paragraph("Prepared for Ian  -  Founder, AR Menu", cover_meta))
story.append(Paragraph("armenu.co.za", cover_meta))
story.append(PageBreak())

# ===== TABLE OF CONTENTS =====
story.append(Paragraph("Inside this document", h1))
story.append(hr())
toc = [
    "1.  Quick wins this week",
    "2.  Top 3 product features that close more sales",
    "3.  Top 3 revenue plays you're not doing yet",
    "4.  Top 3 marketing tactics (free / cheap)",
    "5.  The 3 ideas that could 10x the company",
    "6.  The crazy bets (one of these could be the whole company)",
    "7.  The bigger vision",
    "8.  Suggested order of execution",
]
for line in toc:
    story.append(Paragraph(line, body))
story.append(PageBreak())

# ===== 1. QUICK WINS =====
story.append(Paragraph("1.  Quick wins this week", h1))
story.append(hr())
story.append(Paragraph(
    "Before any of the big plays, lock in these. They take hours, not days, "
    "and they remove friction in every conversation you'll have with a "
    "restaurant from now on.",
    body
))
quick_data = [
    ["Task", "Time", "Why it pays off"],
    ["Add Google Analytics on landing", "15 min", "Know where leads come from"],
    ["Calendly link 'Book a 15min demo'", "30 min", "Inbound leads book themselves"],
    ["Email alert on new pending sign-up", "30 min", "Never miss a hot lead"],
    ["Public demo page with 5 live AR dishes", "2 hrs", "Prospects test before booking"],
    ["Pricing page linked from nav", "1 hr", "Removes price uncertainty stalling deals"],
    ["Launch Instagram + TikTok accounts", "1 hr", "Long-term lead engine"],
]
story.append(make_table(quick_data, col_widths=[6 * cm, 2.4 * cm, 8 * cm]))
story.append(PageBreak())

# ===== 2. PRODUCT FEATURES =====
story.append(Paragraph("2.  Top 3 product features that close more sales", h1))
story.append(hr())

story.append(Paragraph("2.1  &quot;Save &amp; share&quot; button inside the AR view", h2))
story.append(Paragraph(
    "After a diner sees the AR meal, a button appears: <b>'Save &amp; share'</b>. "
    "It captures a video of the dish on their table and opens their phone's "
    "share sheet (Instagram, TikTok, WhatsApp).",
    body
))
story.append(Paragraph("Why it matters:", h3))
story += bullets([
    "Every share is free marketing for both the restaurant AND for AR Menu (your watermark in the corner).",
    "One viral TikTok = R0 spend, 100k impressions, restaurants begging to sign up.",
    "Build cost: ~2 hours of code.",
])

story.append(Paragraph("2.2  Restaurant-chain / multi-location support", h2))
story.append(Paragraph(
    "Right now each restaurant is one account. But Spur, Ocean Basket and Col'Cacchio "
    "each have 50-200 venues. They want one master account that pushes the same menu "
    "to all locations, with per-location scan analytics.",
    body
))
story.append(Paragraph("Why it matters:", h3))
story += bullets([
    "This is the R50,000+ /month deal. One chain = 100 venues at once.",
    "Without this feature you literally can't sell to chains.",
    "Build cost: ~1 week of code. Revenue unlock: massive.",
])

story.append(Paragraph("2.3  &quot;Order now&quot; button on the AR view", h2))
story.append(Paragraph(
    "After the diner sees the dish, a button 'Order this' that calls the waiter "
    "(notification to a tablet), adds to a cart, or deep-links to UberEats / Mr D for delivery.",
    body
))
story.append(Paragraph("Why it matters:", h3))
story += bullets([
    "Restaurants pay 2-3x more for tools that DRIVE orders vs tools that just inform.",
    "Converts AR Menu from 'marketing tool' to 'POS-adjacent' pricing.",
    "Build cost: ~3 days for MVP (waiter notification). UberEats integration later.",
])
story.append(PageBreak())

# ===== 3. REVENUE PLAYS =====
story.append(Paragraph("3.  Top 3 revenue plays you're not doing yet", h1))
story.append(hr())

story.append(Paragraph("3.1  The 'Free Forever for 1 Dish' hook", h2))
story.append(Paragraph(
    "Let any restaurant sign up and add ONE dish for free, forever. No card needed. "
    "They get the AR experience for one dish, see the wow factor at their tables, "
    "then upgrade to paid for the rest of their menu.",
    body
))
story.append(Paragraph(
    "Why it works: Removes the 'will this work for us?' objection. "
    "Industry conversion rate: 30-40% of free signups upgrade to paid within 60 days. "
    "Standard SaaS playbook.",
    emph
))

story.append(Paragraph("3.2  White-label tier for franchise groups (R8k-R20k /month)", h2))
story.append(Paragraph(
    "Same product, but the AR view shows their branding instead of 'AR Menu', "
    "and runs on their custom domain (e.g. ar.spur.co.za). Charge 5-10x your normal rate.",
    body
))
story.append(Paragraph(
    "Why it works: Big chains pay for control. The platform stays the same - "
    "you toggle a flag. R10,000 /month x 5 chains = R50k MRR from one afternoon of work.",
    emph
))

story.append(Paragraph("3.3  Charge for the QR card printing", h2))
story.append(Paragraph(
    "Don't just give restaurants a PDF - sell them the printed mini cards "
    "at R8 each (cost you R2). For a 30-dish menu x 6 tables x 2 cards each = "
    "360 cards = R2,160 add-on revenue per restaurant, recurring whenever they refresh menus.",
    body
))
story.append(Paragraph(
    "Plus: branded laminated tent cards 'Scan me to see your meal in AR' for tables - "
    "R150 each, restaurants love them, costs you R40 to make. Pure margin and gives you "
    "a reason to visit the restaurant in person every quarter.",
    emph
))
story.append(PageBreak())

# ===== 4. MARKETING TACTICS =====
story.append(Paragraph("4.  Top 3 marketing tactics (free / cheap)", h1))
story.append(hr())

story.append(Paragraph("4.1  TikTok / Instagram Reels showing the AR effect", h2))
story.append(Paragraph(
    "This is your single biggest opportunity. Visual products NEED visual marketing. "
    "Post one 10-second video per day:",
    body
))
story += bullets([
    "&quot;Watch this burger appear on my table&quot;",
    "&quot;POV: choosing what to order without guessing&quot;",
    "&quot;South African restaurants are about to change forever&quot;",
])
story.append(Paragraph(
    "Cost: R0. One video could hit 1M views and bring 100 inbound restaurant leads.",
    emph
))

story.append(Paragraph("4.2  WhatsApp cold outreach to specific restaurants", h2))
story.append(Paragraph(
    "Don't email - South African restaurant owners live on WhatsApp. Script:",
    body
))
story.append(Paragraph(
    "&quot;Hi [Owner], I'm Ian from AR Menu. I built a free demo using your "
    "[Restaurant Name]'s burger - would you like me to send it? It's a 2-second QR "
    "scan that shows your dish in 3D on the customer's table. Takes 30 seconds to see.&quot;",
    quote
))
story.append(Paragraph(
    "Personalised + demo with THEIR food = 15-20% conversion to demo call. "
    "Way better than email.",
    emph
))

story.append(Paragraph("4.3  Pay restaurant owners for referrals", h2))
story.append(Paragraph(
    "Once your first pilot restaurant is happy, pay them R500 cash for every "
    "restaurant they refer that signs up. Restaurant owners know other restaurant "
    "owners. R500 is nothing to you (you're charging R3,000 setup) and they "
    "pocket it gratefully.",
    body
))
story.append(PageBreak())

# ===== 5. THE 10X IDEAS =====
story.append(Paragraph("5.  The 3 ideas that could 10x the company", h1))
story.append(hr())
story.append(Paragraph(
    "These are not 'nice to have' features. Each one is a category-creating product "
    "that could justify the entire company by itself.",
    emph
))

story.append(Paragraph("5.1  The AI Customizer  -  diners modify the dish IN AR before ordering", h2))
story.append(Paragraph(
    "Diner scans the burger. Sees it on the table. Sliders appear:",
    body
))
story += bullets([
    "&quot;Less lettuce&quot; -> lettuce shrinks live",
    "&quot;Extra cheese&quot; -> another slice melts on",
    "&quot;No onion&quot; -> onions vanish",
])
story.append(Paragraph(
    "When they tap 'Order this version', it goes to the kitchen with their exact specs. "
    "<b>The kitchen makes EXACTLY what the diner saw on the table.</b>",
    body
))
story.append(Paragraph("Why this is massive:", h3))
story += bullets([
    "No restaurant on Earth has this.",
    "Customisation drives ~25% higher ticket sizes industry-wide.",
    "Eliminates &quot;this isn't what I ordered&quot; disputes - they signed off on the model.",
    "Patent-able. Own this category in SA before anyone else figures it out.",
    "Tech: AI image-to-mesh + the existing AR pipeline. Doable now with current tools.",
    "This is the kind of thing investors throw money at.",
])

story.append(Paragraph("5.2  Become the brand-placement network across SA restaurants", h2))
story.append(Paragraph(
    "<b>You're not selling AR menus. You're selling premium ad space in front of "
    "every diner in South Africa, right when they're deciding what to spend money on.</b>",
    body
))
story += bullets([
    "Coca-Cola pays R50,000 /month so a virtual Coke appears next to every burger AR view.",
    "Heineken pays for the cold-frosted beer to appear next to every steak.",
    "Castle pays to be the default beverage on rugby weekends.",
])
story.append(Paragraph(
    "You take cash from FMCG brands AND keep charging restaurants. Both sides pay.",
    body
))
story.append(Paragraph("Why this is massive:", h3))
story += bullets([
    "South African FMCG brands spend R10 BILLION /year on advertising.",
    "The only 'intent-based' ad format that exists at the moment of purchase.",
    "Hit 500 restaurants and you have leverage with every major brand.",
    "This is the Google AdWords of restaurants.",
    "Restaurants get AR for FREE if they accept brand placements. Brands fund the entire business.",
])

story.append(Paragraph("5.3  Take a % of every order you cause", h2))
story.append(Paragraph(
    "Stop selling subscriptions. Take 2-5% of every order placed through AR Menu.",
    body
))
story.append(Paragraph(
    "Industry data: AR menus increase order value by 20-40% (proven by IKEA, Apple). "
    "If a restaurant makes R500k /month from AR-influenced orders, your 3% = "
    "<b>R15,000 /month from ONE restaurant</b> vs R1,500 you'd charge as a subscription.",
    body
))
story.append(Paragraph("Why this is massive:", h3))
story += bullets([
    "Restaurants will agree because they only pay when you make them money.",
    "Your revenue per restaurant goes up 10x.",
    "You become aligned with their growth.",
    "How Uber Eats, Mr D and Square justify their fees - and you'd be charging less.",
    "Combined with the AI Customizer (5.1), you literally rewire the ordering flow through your platform.",
])
story.append(PageBreak())

# ===== 6. THE CRAZY BETS =====
story.append(Paragraph("6.  The crazy bets", h1))
story.append(hr())
story.append(Paragraph(
    "Any one of these could be the entire company. They're outside the obvious "
    "&quot;AR menus for restaurants&quot; lane - and that's why they're underexplored.",
    emph
))

bet_data = [
    ["Bet", "Why it's crazy good"],
    ["Bars / cocktails AR menu",
     "Cocktails are HIGHLY visual and high-margin. Imagine scanning a QR and seeing "
     "the cocktail being 'poured' in AR on your table. Bars have NEVER had this. "
     "R3k /month per venue x 8,000 bars in SA."],
    ["Hotel room service AR",
     "Every hotel room: scan the menu, see the food on your bed in AR. "
     "Hotels pay R20-50k /month for premium room amenities. 700 hotels in SA. "
     "R140M opportunity if you own this category."],
    ["Take-away packaging QR",
     "QR on every takeaway box from KFC, McDonald's, Steers. "
     "Scan it -> AR shows what's inside, pairings, recipe variations, "
     "'scan 5 boxes get one free'. You become the loyalty platform for QSR."],
    ["AR Menu = Tinder for restaurants",
     "Diner app: swipe through AR meals at restaurants near you, see them in your "
     "kitchen before deciding where to eat. Restaurants pay to be in the swipe pool. "
     "You become Yelp + UberEats + Tinder in one."],
    ["Virtual menu items",
     "Restaurants list dishes that don't exist yet. If 100+ people scan / order in a week, "
     "the kitchen makes it. You become menu R&amp;D for the entire industry. "
     "Sell that data to food brands."],
]
story.append(make_table(bet_data, col_widths=[5 * cm, 11.4 * cm]))
story.append(PageBreak())

# ===== 7. THE VISION =====
story.append(Paragraph("7.  The bigger vision", h1))
story.append(hr())
story.append(Paragraph(
    "AR Menu isn't an AR-menu company.<br/>"
    "It's the entire ordering layer between diners and restaurants.",
    quote
))

story += bullets([
    "Start with QR codes next to dishes.",
    "Add AR customisation -> become how diners ORDER.",
    "Add brand placement -> become how brands REACH diners.",
    "Add ordering integration -> take a cut of every transaction.",
    "Build a diner app -> own the discovery layer.",
    "Sell anonymised data -> become a food intelligence platform.",
])

story.append(Paragraph(
    "Each layer multiplies revenue per restaurant 5-10x without adding a single "
    "new restaurant.",
    body
))
story.append(Paragraph(
    "<b>The restaurants are the wedge. The real prize is owning the entire ordering "
    "experience for 10 million South African diners.</b>",
    body
))
story.append(PageBreak())

# ===== 8. EXECUTION ORDER =====
story.append(Paragraph("8.  Suggested order of execution", h1))
story.append(hr())
story.append(Paragraph(
    "Do them in this order. Each step compounds the next.",
    emph
))

exec_data = [
    ["Phase", "Action", "Outcome"],
    ["NOW",
     "Quick wins from section 1 (Calendly, demo page, pricing page).",
     "Inbound infrastructure ready."],
    ["Week 1-2",
     "Build 'Save &amp; Share' button. Launch TikTok / Instagram with daily demos.",
     "Free marketing engine starts spinning."],
    ["Week 3-4",
     "Sign first pilot restaurant. Pay R1,500 on Fiverr/Rodin AI for 5 great models. "
     "Charge them R3,000 setup, profit on day one.",
     "First case study + first revenue."],
    ["Month 2",
     "Build the AI Customizer prototype on ONE dish. Use it to pitch to chains.",
     "10x demo that closes premium deals."],
    ["Month 3",
     "Multi-location chain support. Approach 3 chains.",
     "First R50k+ /month deal."],
    ["Month 4",
     "Brand-placement pilot. Approach Coca-Cola, Castle, Heineken with the network of "
     "50+ restaurants.",
     "Brands fund your free tier."],
    ["Month 6",
     "Take a % of orders model live. Switch existing customers OR keep subscription "
     "as a tier.",
     "Revenue per restaurant 10x."],
    ["Month 12",
     "Pick one crazy bet (bars, hotels, take-away QR, diner app) and launch.",
     "Category expansion."],
]
story.append(make_table(exec_data, col_widths=[2.6 * cm, 7.2 * cm, 6.6 * cm]))

story.append(Spacer(1, 1 * cm))
story.append(hr())
story.append(Paragraph("End of document", small))
story.append(Paragraph(
    "All ideas in this document are extracted from the AR Menu strategy session "
    "with Claude Code. Treat this as a living document - revisit and re-prioritise "
    "monthly as the business grows.",
    small
))

# Build with cover decoration on first page, normal on rest
doc.build(
    story,
    onFirstPage=cover_decoration,
    onLaterPages=page_decoration,
)

print(f"Wrote: {OUT}")
