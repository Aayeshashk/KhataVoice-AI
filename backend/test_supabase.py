import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SECRET_KEY")

if not url or not key:
    raise ValueError("Supabase credentials missing from .env")

supabase = create_client(url, key)

try:
    response = supabase.table("customers").select("id").limit(1).execute()
    print("SUCCESS: Connected to Supabase!")
    print("Customers table is accessible.")
    print("Rows returned:", len(response.data))
except Exception as e:
    print("CONNECTION FAILED:")
    print(e)