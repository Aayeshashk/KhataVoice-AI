import os

import re

import unicodedata

import httpx

from dotenv import load_dotenv

from fastapi import FastAPI, File, HTTPException, UploadFile

from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel, Field

from supabase import create_client

from uuid import UUID

load_dotenv()

# -------------------------------------------------------------------

# ENVIRONMENT CONFIGURATION

# -------------------------------------------------------------------

GNANI_API_KEY = os.getenv("GNANI_API_KEY")

GNANI_STT_URL = "https://api.vachana.ai/stt/v3"

SUPABASE_URL = os.getenv("SUPABASE_URL")

SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY")

supabase = (

    create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)

    if SUPABASE_URL and SUPABASE_SECRET_KEY

    else None

)

app = FastAPI(

    title="KhataVoice AI Backend",

    description="Voice-powered digital ledger for small businesses",

    version="1.5.0",

)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "https://khata-voice-dk0842lah-aayeshash2412-1885.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -------------------------------------------------------------------

# REQUEST MODELS

# -------------------------------------------------------------------

class CustomerInput(BaseModel):

    id: int

    name: str

class ProductInput(BaseModel):

    id: int

    name: str

    category: str = ""

    unit: str = ""

    price: float = Field(gt=0)

class ParseTransactionRequest(BaseModel):

    transcript: str = Field(min_length=1, max_length=2000)

    customers: list[CustomerInput] = Field(default_factory=list)

    products: list[ProductInput] = Field(default_factory=list)

class ConfirmTransactionRequest(BaseModel):

    customer_id: int = Field(gt=0)

    product_id: int | None = Field(default=None, gt=0)

    description: str = Field(min_length=1, max_length=500)

    transaction_type: str

    amount: float = Field(gt=0)

    quantity: float | None = Field(default=None, gt=0)

    original_transcript: str | None = Field(default=None, max_length=2000)

    detected_language: str | None = Field(default=None, max_length=50)

    request_id: UUID

# -------------------------------------------------------------------

# HINDI / UNICODE NORMALIZATION

# -------------------------------------------------------------------

def normalize_text(value: str) -> str:

    value = unicodedata.normalize("NFKC", value).lower()

    # Preserve Hindi characters, vowel signs and other Unicode

    # combining marks during text matching.

    cleaned = "".join(

        char

        if (

            char.isspace()

            or char == "₹"

            or unicodedata.category(char)[0] in {"L", "N", "M"}

        )

        else " "

        for char in value

    )

    return re.sub(r"\s+", " ", cleaned).strip()

# -------------------------------------------------------------------

# HINDI CUSTOMER ALIASES

# -------------------------------------------------------------------

CUSTOMER_FIRST_NAME_ALIASES = {

    "amit": ["अमित", "amit"],

    "ramesh": ["रमेश", "ramesh"],

    "priya": ["प्रिया", "priya"],

    "sneha": ["स्नेहा", "sneha"],

    "rahul": ["राहुल", "rahul"],

}

# -------------------------------------------------------------------

# CUSTOMER FULL-NAME SPEECH ALIASES

# -------------------------------------------------------------------

# Add alternate phrases that speech recognition may produce for a
# customer's registered name. Keys must match normalized customer names.
CUSTOMER_NAME_ALIASES = {}

# -------------------------------------------------------------------

# PRODUCT ALIASES

# -------------------------------------------------------------------

PRODUCT_ALIASES = {

    # Hindi, Marathi and common English speech variants.
    "rice": ["चावल", "चावळ", "तांदूळ", "तांदुल", "तांदुळ", "rice"],

    "wheat flour": [

        "आटा",

        "गेहूं का आटा",

        "गहूं का आटा",

        "wheat flour",

        "atta",

    ],

    "cooking oil": [

        "तेल",

        "खाने का तेल",

        "cooking oil",

        "oil",

    ],

    "sugar": ["चीनी", "शक्कर", "sugar"],

    "milk": ["दूध", "दुध", "milk"],

    "pasta": ["पास्ता", "pasta"],

}

# -------------------------------------------------------------------

# CUSTOMER MATCHING

# -------------------------------------------------------------------

def find_customer(
    transcript: str,
    customers: list[CustomerInput],
) -> CustomerInput | None:
    text = normalize_text(transcript)
    padded_text = f" {text} "
    matches = []

    for customer in customers:
        normalized_name = normalize_text(customer.name)

        # Match the registered full name and configured speech aliases.
        full_name_aliases = CUSTOMER_NAME_ALIASES.get(
            normalized_name,
            [normalized_name],
        )

        normalized_aliases = [
            normalize_text(alias)
            for alias in full_name_aliases
            if alias
        ]

        def customer_alias_is_spoken(alias: str) -> bool:
            if not alias:
                return False
            # Indian-language speech commonly attaches case markers to names:
            # रमेश -> रमेशला, अमित -> अमितने, राहुल -> राहुलला.
            pattern = (
                rf"(?<!\w){re.escape(alias)}"
                rf"(?:ला|ने|ना|को|के|की|का|च्या|चा|ची|चे|कडे|कडून)?"
                rf"(?!\w)"
            )
            return re.search(pattern, text, flags=re.IGNORECASE) is not None

        if any(customer_alias_is_spoken(alias) for alias in normalized_aliases):
            matches.append(customer)
            continue

        # Fall back to first-name aliases for the original sample customers.
        name_parts = normalized_name.split()
        first_name = name_parts[0] if name_parts else ""

        first_name_aliases = CUSTOMER_FIRST_NAME_ALIASES.get(
            first_name,
            [first_name],
        )

        if any(
            customer_alias_is_spoken(normalize_text(alias))
            for alias in first_name_aliases
        ):
            matches.append(customer)

    # Do not guess if multiple customers match.
    unique = {
        customer.id: customer
        for customer in matches
    }

    if len(unique) == 1:
        return next(iter(unique.values()))

    return None


def find_product(

    transcript: str,

    products: list[ProductInput],

) -> ProductInput | None:

    text = normalize_text(transcript)

    matches = []

    for product in products:

        normalized_name = normalize_text(product.name)

        aliases = PRODUCT_ALIASES.get(

            normalized_name,

            [normalized_name],

        )

        if any(

            normalize_text(alias) in text

            for alias in aliases

            if alias

        ):

            matches.append(product)

    unique = {

        product.id: product

        for product in matches

    }

    # Do not guess when multiple catalogue products match.

    if len(unique) == 1:

        return next(iter(unique.values()))

    return None

# -------------------------------------------------------------------

# AMOUNT EXTRACTION

# -------------------------------------------------------------------

def extract_amount(transcript: str) -> float | None:

    patterns = [

        r"(?:₹|rs\.?\s*)\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)",

        r"(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:रुपये|रुपया|रुपए|रु\.?|rupees?|rs\.?)",

    ]

    for pattern in patterns:

        match = re.search(

            pattern,

            transcript,

            flags=re.IGNORECASE,

        )

        if match:

            return float(

                match.group(1).replace(",", "")

            )

    return None

# -------------------------------------------------------------------

# QUANTITY EXTRACTION

# -------------------------------------------------------------------

def extract_quantity(
    transcript: str,
    product: ProductInput | None,
) -> float | None:
    if not product:
        return None

    unit_aliases = {
        "kg": r"(?:kg|किलो|किलोग्राम)",
        "gram": r"(?:g|gram|grams|ग्राम)",
        "litre": r"(?:l|litre|liter|लीटर|लिटर)",
        "ml": r"(?:ml|मिलीलीटर)",
        "piece": r"(?:pieces?|pcs?|पीस)",
        "packet": r"(?:packets?|packet|पैकेट)",
        "dozen": r"(?:dozen|दर्जन)",
        "box": r"(?:boxes?|box|डिब्बे?)",
    }
    unit_pattern = unit_aliases.get(product.unit.lower())
    if not unit_pattern:
        return None

    number_words = {
        "एक": "1", "दोन": "2", "दो": "2", "तीन": "3",
        "चार": "4", "पाच": "5", "पांच": "5", "छह": "6",
        "सहा": "6", "सात": "7", "आठ": "8", "नऊ": "9",
        "नौ": "9", "दहा": "10", "दस": "10",
    }
    devanagari_digits = str.maketrans("०१२३४५६७८९", "0123456789")
    normalized_transcript = transcript.translate(devanagari_digits)

    number_pattern = r"(\d+(?:\.\d+)?|" + "|".join(
        re.escape(word) for word in number_words
    ) + r")"
    match = re.search(
        rf"({number_pattern})\s*{unit_pattern}",
        normalized_transcript,
        flags=re.IGNORECASE,
    )
    if not match:
        return None

    raw_number = number_words.get(match.group(1), match.group(1))
    try:
        return float(raw_number)
    except ValueError:
        return None


def extract_transaction_type(
    transcript: str,
) -> str | None:
    text = normalize_text(transcript)

    # Hindi, Marathi and English phrases that indicate money received
    # from a customer. Keep repayment phrases explicit so that an
    # ordinary "gave" phrase is not incorrectly classified as Payment.
    payment_terms = [
        # English
        "payment", "paid", "received", "jama",
        "money returned", "paid back", "returned the money",

        # Hindi
        "जमा", "भुगतान", "पेमेंट", "पैसे वापस", "रकम मिली",
        "वापस दिया", "वापस दिए", "वापस दी",
        "वापस कर दिया", "वापस कर दिए",
        "लौटा दिया", "लौटा दिए", "लौटाए", "लौटाया",
        "चुका दिया", "चुका दिए", "चुका",
        "पैसे लौटा", "रकम वापस",

        # Marathi
        "परत दिले", "परत दिला", "परत दिली", "परत दिलं",
        "परत दिए", "परत दिया", "परत दी",
        "परत केले", "परत केला", "परत केली", "परत केलं",
        "पैसे परत", "रक्कम परत",
        "फेडले", "फेडला", "फेडली", "फेडलं",
        "जमा केले", "जमा केला", "जमा केली",
    ]

    credit_terms = [
        "udhaar", "उधार", "credit", "on credit", "बाकी में",
    ]

    has_payment = any(term in text for term in payment_terms)
    has_credit = any(term in text for term in credit_terms)

    # If both intents are explicitly present, require manual review.
    if has_payment and has_credit:
        return None
    if has_payment:
        return "Payment"
    if has_credit:
        return "Credit"
    return None

@app.get("/")

async def home():

    return {

        "message": "KhataVoice AI backend is running!",

        "status": "healthy",

    }

# -------------------------------------------------------------------

# HEALTH CHECK

# -------------------------------------------------------------------

@app.get("/api/health")

async def health():

    return {

        "backend": "online",

        "gnani_api_key_configured": bool(GNANI_API_KEY),

        "supabase_configured": supabase is not None,

    }

# -------------------------------------------------------------------

# GNANI PRISMA TRANSCRIPTION

# -------------------------------------------------------------------

@app.post("/api/transcribe")

async def transcribe_audio(

    audio: UploadFile = File(...),

):

    if not GNANI_API_KEY:

        raise HTTPException(

            status_code=500,

            detail="Gnani API key is not configured.",

        )

    allowed_types = {

        "audio/wav",

        "audio/x-wav",

        "audio/mpeg",

        "audio/mp3",

        "audio/ogg",

        "audio/flac",

        "audio/aac",

        "audio/mp4",

        "audio/x-m4a",

        "audio/webm",

    }

    if audio.content_type not in allowed_types:

        raise HTTPException(

            status_code=415,

            detail=f"Unsupported audio type: {audio.content_type}",

        )

    audio_bytes = await audio.read()

    if not audio_bytes:

        raise HTTPException(

            status_code=400,

            detail="The uploaded audio file is empty.",

        )

    if len(audio_bytes) > 25 * 1024 * 1024:

        raise HTTPException(

            status_code=413,

            detail="Audio file must be smaller than 25 MB.",

        )

    headers = {

        "X-API-Key-ID": GNANI_API_KEY,

    }

    files = {

        "audio_file": (

            audio.filename or "recording.wav",

            audio_bytes,

            audio.content_type,

        )

    }

    data = {

        "model": "prisma-v3.0",

        "language_code": "indic-auto",

        "format": "transcribe",

    }

    try:

        async with httpx.AsyncClient(

            timeout=60.0

        ) as client:

            response = await client.post(

                GNANI_STT_URL,

                headers=headers,

                files=files,

                data=data,

            )

        if response.is_error:

            print(

                "Gnani API error:",

                response.status_code,

                response.text,

            )

            raise HTTPException(

                status_code=502,

                detail="Gnani transcription failed. Check API key, permissions and audio.",

            )

        result = response.json()

        return {

            "success": result.get("success", True),

            "transcript": result.get("transcript", ""),

            "detected_language": result.get(

                "detected_language_code"

            ),

            "model": result.get(

                "model",

                "prisma-v3.0",

            ),

            "request_id": result.get("request_id"),

        }

    except httpx.TimeoutException:

        raise HTTPException(

            status_code=504,

            detail="Gnani transcription timed out. Please try again.",

        )

    except httpx.RequestError:

        raise HTTPException(

            status_code=502,

            detail="Could not connect to Gnani. Please try again.",

        )

# -------------------------------------------------------------------

# TRANSACTION PARSING

# -------------------------------------------------------------------

@app.post("/api/parse-transaction")
async def parse_transaction(
    request: ParseTransactionRequest,
):
    transcript = request.transcript.strip()

    if not transcript:
        raise HTTPException(
            status_code=400,
            detail="Transcript cannot be empty.",
        )

    customer = find_customer(transcript, request.customers)
    product = find_product(transcript, request.products)
    amount = extract_amount(transcript)
    quantity = extract_quantity(transcript, product)
    transaction_type = extract_transaction_type(transcript)

    # A product that was not spoken is allowed. A spoken product that
    # cannot be matched uniquely should still be shown for manual review.
    normalized_transcript = normalize_text(transcript)
    product_was_mentioned = any(
        normalize_text(alias) in normalized_transcript
        for catalogue_product in request.products
        for alias in PRODUCT_ALIASES.get(
            normalize_text(catalogue_product.name),
            [catalogue_product.name],
        )
        if normalize_text(alias)
    )

    warnings = []

    if not customer:
        warnings.append(
            "Customer could not be identified uniquely. Select the customer manually."
        )

    if product_was_mentioned and not product:
        warnings.append(
            "The spoken product could not be identified uniquely. Select it manually or leave it blank."
        )

    if transaction_type is None:
        warnings.append(
            "Transaction type is unclear. Choose Credit or Payment."
        )

    if amount is None and quantity is None:
        warnings.append(
            "No amount or measurable quantity was identified."
        )

    if (
        transaction_type == "Credit"
        and product is not None
        and quantity is None
        and amount is not None
    ):
        warnings.append(
            "Quantity was not spoken. The stated amount will be used as the transaction amount."
        )

    calculated_amount = amount

    # When only quantity is spoken, use the matched catalogue price.
    # Never estimate or ask an AI model to calculate the transaction total.
    if (
        calculated_amount is None
        and transaction_type == "Credit"
        and quantity is not None
        and product is not None
    ):
        calculated_amount = round(quantity * product.price, 2)

    # Product is optional whenever an explicit transaction amount exists.
    # A quantity-only credit still needs a matched product price.
    ready = bool(
        customer
        and transaction_type
        and calculated_amount is not None
    )

    return {
        "success": True,
        "ready_for_confirmation": ready,
        "transcript": transcript,
        "customer": (
            {"id": customer.id, "name": customer.name}
            if customer else None
        ),
        "product": (
            {
                "id": product.id,
                "name": product.name,
                "unit": product.unit,
                "unit_price": product.price,
            }
            if product else None
        ),
        "quantity": quantity,
        "transaction_type": transaction_type,
        "amount": calculated_amount,
        "warnings": warnings,
        "note": (
            "This is a draft only. No customer balance "
            "or ledger entry has been changed."
        ),
    }


def _extract_database_error(error: Exception) -> str:
    """Return a useful, non-secret database error message for validation."""
    parts = []
    for attribute in ("message", "details", "hint"):
        value = getattr(error, attribute, None)
        if value:
            parts.append(str(value))
    if not parts:
        parts.append(str(error))
    return " ".join(parts).strip()


def _transaction_error_response(error: Exception) -> tuple[int, str]:
    """Translate known database failures into clear messages for the UI."""
    message = _extract_database_error(error).lower()
    known_errors = [
        ("payment exceeds outstanding balance", 409,
         "This payment is greater than the customer's outstanding balance. Reduce the payment amount and try again."),
        ("customer not found", 404,
         "The selected customer could not be found. Refresh the customer list and try again."),
        ("product not found", 404,
         "The selected product could not be found. Refresh the product catalogue and try again."),
        ("invalid transaction type", 400,
         "Choose either Credit or Payment before confirming."),
        ("amount must be greater than zero", 400,
         "Enter an amount greater than ₹0."),
        ("transaction request id is required", 400,
         "The transaction request ID is missing. Discard this draft and record it again."),
        ("insufficient stock", 409,
         "There is not enough product stock for this transaction. Update the quantity or stock and try again."),
    ]
    for marker, status_code, user_message in known_errors:
        if marker in message:
            return status_code, user_message
    if "duplicate key" in message or "unique constraint" in message:
        return 409, "This transaction request has already been recorded. Refresh the ledger before trying again."
    if "foreign key" in message or "violates foreign key constraint" in message:
        return 409, "The selected customer or product is linked to existing records and could not be used."
    return 400, (
        "The transaction could not be saved. Check the customer, product and amount, "
        "then try again. If this was a retry, use the same request ID."
    )


@app.post("/api/confirm-transaction")
async def confirm_transaction(request: ConfirmTransactionRequest):
    """Confirm a reviewed transaction through the atomic Supabase RPC.

    Idempotency is enforced by confirm_khata_transaction in PostgreSQL:
    retries must reuse the same request_id. A newly generated request_id
    represents a new transaction, even if the amount and description match.
    """
    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase is not configured. Check backend .env settings.",
        )

    if request.transaction_type not in ("Credit", "Payment"):
        raise HTTPException(
            status_code=400,
            detail="Transaction type must be Credit or Payment.",
        )

    try:
        rpc_result = supabase.rpc(
            "confirm_khata_transaction",
            {
                "p_customer_id": request.customer_id,
                "p_product_id": request.product_id,
                "p_description": request.description.strip(),
                "p_transaction_type": request.transaction_type,
                "p_amount": request.amount,
                "p_quantity": request.quantity,
                "p_original_transcript": request.original_transcript,
                "p_detected_language": request.detected_language,
                "p_source": "voice",
                "p_request_id": str(request.request_id),
            },
        ).execute()

        rpc_data = rpc_result.data
        if isinstance(rpc_data, list):
            rpc_data = rpc_data[0] if rpc_data else None

        if not isinstance(rpc_data, dict):
            raise HTTPException(
                status_code=502,
                detail="The database returned an unexpected confirmation response.",
            )

        if rpc_data.get("success") is False:
            message = rpc_data.get("message") or "The transaction was not accepted."
            raise HTTPException(status_code=409, detail=message)

        return {
            "success": True,
            "duplicate": bool(rpc_data.get("duplicate", False)),
            "data": rpc_data,
        }

    except HTTPException:
        raise
    except Exception as error:
        print("Supabase transaction confirmation error:", repr(error))
        status_code, user_message = _transaction_error_response(error)
        raise HTTPException(status_code=status_code, detail=user_message)


# -------------------------------------------------------------------
# DATABASE READ APIs
# -------------------------------------------------------------------

def get_supabase_client():
    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase is not configured."
        )
    return supabase


@app.get("/api/customers")
async def get_customers():
    try:
        result = (
            get_supabase_client()
            .table("customers")
            .select("id, name, phone, balance, opening_balance, initials")
            .eq("is_demo", False)
            .order("id")
            .execute()
        )

        return {
            "success": True,
            "data": result.data
        }

    except Exception as error:
        print("Customers API error:", repr(error))
        raise HTTPException(
            status_code=500,
            detail="Could not fetch customers."
        )


@app.get("/api/products")
async def get_products():
    try:
        result = (
            get_supabase_client()
            .table("products")
            .select("id, name, category, unit, price, stock")
            .order("id")
            .execute()
        )

        return {
            "success": True,
            "data": result.data
        }

    except Exception as error:
        print("Products API error:", repr(error))
        raise HTTPException(
            status_code=500,
            detail="Could not fetch products."
        )


@app.get("/api/transactions")
async def get_transactions():
    try:
        result = (
            get_supabase_client()
            .table("transactions")
            .select(
                "id, customer_id, product_id, description, "
                "transaction_type, amount, quantity, "
                "original_transcript, detected_language, "
                "source, created_at"
            )
            .order("created_at", desc=True)
            .execute()
        )

        return {
            "success": True,
            "data": result.data
        }

    except Exception as error:
        print("Transactions API error:", repr(error))
        raise HTTPException(
            status_code=500,
            detail="Could not fetch transactions."
        )

# -------------------------------------------------------------------
# CREATE CUSTOMER - SAVE TO SUPABASE
# -------------------------------------------------------------------

class CreateCustomerRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    phone: str = Field(min_length=10, max_length=10)


@app.post("/api/customers")
async def create_customer(request: CreateCustomerRequest):

    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase is not configured.",
        )

    name = request.name.strip()
    phone = request.phone.strip()

    if not name:
        raise HTTPException(
            status_code=400,
            detail="Customer name cannot be empty.",
        )

    if not phone.isdigit() or len(phone) != 10:
        raise HTTPException(
            status_code=400,
            detail="Enter a valid 10-digit phone number.",
        )

    initials = "".join(
        part[0] for part in name.split() if part
    )[:2].upper()

    try:
        result = (
            supabase.table("customers")
            .insert({
                "name": name,
                "phone": phone,
                "balance": 0,
                "initials": initials,
                "is_demo": False,
            })
            .execute()
        )

        if not result.data:
            raise HTTPException(
                status_code=500,
                detail="Customer could not be created.",
            )

        return {
            "success": True,
            "message": "Customer created successfully.",
            "data": result.data[0],
        }

    except Exception as error:
        print("Create customer error:", repr(error))

        error_message = str(error).lower()

        if "duplicate key" in error_message or "unique constraint" in error_message:
            raise HTTPException(
                status_code=409,
                detail="A customer with this phone number already exists.",
            )

        raise HTTPException(
            status_code=500,
            detail="Could not create customer. Please try again.",
        )

class CreateProductRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    category: str = "Essentials"
    unit: str = "kg"
    price: float = Field(gt=0)
    stock: float = Field(default=0, ge=0)


@app.post("/api/products")
async def create_product(request: CreateProductRequest):
    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase is not configured.",
        )

    try:
        result = (
            supabase.table("products")
            .insert({
                "name": request.name.strip(),
                "category": request.category.strip() or "Essentials",
                "unit": request.unit.strip() or "kg",
                "price": request.price,
                "stock": request.stock,
            })
            .execute()
        )

        if not result.data:
            raise HTTPException(
                status_code=500,
                detail="Product could not be created.",
            )

        return {
            "success": True,
            "message": "Product created successfully.",
            "data": result.data[0],
        }

    except Exception as error:
        print("Create product error:", repr(error))

        if "duplicate key" in str(error).lower() or "unique constraint" in str(error).lower():
            raise HTTPException(
                status_code=409,
                detail="A product with this name already exists.",
            )

        raise HTTPException(
            status_code=500,
            detail="Could not create product.",
        )

# -------------------------------------------------------------------
# UPDATE PRODUCT - SAVE TO SUPABASE
# -------------------------------------------------------------------

@app.put("/api/products/{product_id}")
async def update_product(
    product_id: int,
    request: CreateProductRequest,
):
    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase is not configured.",
        )

    try:
        result = (
            supabase.table("products")
            .update({
                "name": request.name.strip(),
                "category": request.category.strip() or "Essentials",
                "unit": request.unit.strip() or "kg",
                "price": request.price,
                "stock": request.stock,
            })
            .eq("id", product_id)
            .select("*")
            .execute()
        )

        if not result.data:
            raise HTTPException(
                status_code=404,
                detail="Product not found.",
            )

        return {
            "success": True,
            "message": "Product updated successfully.",
            "data": result.data[0],
        }

    except HTTPException:
        raise

    except Exception as error:
        print("Update product error:", repr(error))

        error_message = str(error).lower()
        if "duplicate key" in error_message or "unique constraint" in error_message:
            raise HTTPException(
                status_code=409,
                detail="A product with this name already exists.",
            )

        raise HTTPException(
            status_code=500,
            detail="Could not update product.",
        )


# -------------------------------------------------------------------
# DELETE PRODUCT - REMOVE FROM SUPABASE
# -------------------------------------------------------------------

@app.delete("/api/products/{product_id}")
async def delete_product(product_id: int):
    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase is not configured.",
        )

    try:
        result = (
            supabase.table("products")
            .delete()
            .eq("id", product_id)
            .execute()
        )

        if not result.data:
            raise HTTPException(
                status_code=404,
                detail="Product not found.",
            )

        return {
            "success": True,
            "message": "Product deleted successfully.",
        }

    except HTTPException:
        raise

    except Exception as error:
        print("Delete product error:", repr(error))

        error_message = str(error).lower()
        if (
            "foreign key" in error_message
            or "violates foreign key constraint" in error_message
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "This product is used in existing transactions and "
                    "cannot be deleted."
                ),
            )

        raise HTTPException(
            status_code=500,
            detail="Could not delete product.",
        )

