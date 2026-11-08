import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  ChevronDown,
  CircleHelp,
  Edit2,
  LayoutDashboard,
  LogOut,
  Menu,
  Mic,
  Package,
  Plus,
  Search,
  Settings,
  ShoppingBag,
  Square,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient, type Session } from '@supabase/supabase-js'

type Customer = {
  id: number
  name: string
  phone: string
  balance: number
  openingBalance: number
  initials: string
}

type Transaction = {
  id: number
  customer: string
  description: string
  type: 'Credit' | 'Payment'
  amount: number
  date: string
}

type LedgerEntry = {
  id: number
  customerId: number
  description: string
  type: 'Credit' | 'Payment'
  amount: number
  date: string
  // Preserve the database timestamp so running balances are calculated chronologically.
  createdAt?: string
}

type Product = {
  id: number
  name: string
  category: string
  unit: string
  price: number
  stock: number
}

type ParsedVoiceTransaction = {
  success: boolean
  ready_for_confirmation: boolean
  transcript: string
  customer: { id: number; name: string } | null
  product: { id: number; name: string; unit: string; unit_price: number } | null
  quantity: number | null
  transaction_type: 'Credit' | 'Payment' | null
  amount: number | null
  warnings: string[]
  note: string
}

const initialProducts: Product[] = [
  { id: 1, name: 'Rice', category: 'Grains', unit: 'kg', price: 60, stock: 45 },
  { id: 2, name: 'Wheat flour', category: 'Grains', unit: 'kg', price: 42, stock: 30 },
  { id: 3, name: 'Cooking oil', category: 'Essentials', unit: 'litre', price: 145, stock: 18 },
  { id: 4, name: 'Sugar', category: 'Essentials', unit: 'kg', price: 48, stock: 25 },
  { id: 5, name: 'Milk', category: 'Dairy', unit: 'litre', price: 58, stock: 12 },
]

const initialCustomers: Customer[] = [
  { id: 1, name: 'Ramesh Kumar', phone: '98765 43210', balance: 2450, openingBalance: 2450, initials: 'RK' },
  { id: 2, name: 'Priya Sharma', phone: '98765 12340', balance: 1200, openingBalance: 1200, initials: 'PS' },
  { id: 3, name: 'Amit Patel', phone: '98765 67890', balance: 850, openingBalance: 850, initials: 'AP' },
  { id: 4, name: 'Sneha Gupta', phone: '98765 09876', balance: 0, openingBalance: 0, initials: 'SG' },
  { id: 5, name: 'Rahul Verma', phone: '98765 56789', balance: 3200, openingBalance: 3200, initials: 'RV' },
]

const initialTransactions: Transaction[] = [
  { id: 1, customer: 'Ramesh Kumar', description: 'Rice, cooking oil', type: 'Credit', amount: 450, date: 'Today, 11:42 AM' },
  { id: 2, customer: 'Priya Sharma', description: 'Partial payment', type: 'Payment', amount: 500, date: 'Today, 10:15 AM' },
  { id: 3, customer: 'Amit Patel', description: 'Groceries', type: 'Credit', amount: 280, date: 'Yesterday, 6:30 PM' },
  { id: 4, customer: 'Sneha Gupta', description: 'Full payment', type: 'Payment', amount: 750, date: 'Yesterday, 4:20 PM' },
]

const navigation = [
  { name: 'Dashboard', icon: LayoutDashboard },
  { name: 'Customers', icon: Users },
  { name: 'Transactions', icon: Activity },
  { name: 'Products', icon: Package },
  { name: 'Settings', icon: Settings },
]


function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const totalSamples = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const pcm = new Int16Array(totalSamples)
  let offset = 0

  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[i]))
      pcm[offset] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      offset += 1
    }
  }

  const buffer = new ArrayBuffer(44 + pcm.length * 2)
  const view = new DataView(buffer)

  const writeText = (position: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(position + i, value.charCodeAt(i))
    }
  }

  writeText(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length * 2, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, pcm.length * 2, true)

  for (let i = 0; i < pcm.length; i += 1) {
    view.setInt16(44 + i * 2, pcm[i], true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

const money = (amount: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount)

function DashboardApp({ onSignOut, userEmail }: { onSignOut: () => void; userEmail: string }) {
  const [activePage, setActivePage] = useState('Dashboard')
  const [search, setSearch] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [voiceInfoOpen, setVoiceInfoOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [readNotifications, setReadNotifications] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('khatavoice_read_notifications') || '[]')
      return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string') : []
    } catch {
      return []
    }
  })
  const [shopSettings, setShopSettings] = useState(() => {
    try { return { shopName: 'Shree Kirana Store', ownerName: 'Shopkeeper', phone: '', address: '', language: 'Hindi', currency: 'INR', lowStock: 5, reminders: true, sound: true, ...(JSON.parse(localStorage.getItem('khatavoice_settings') || '{}')) } }
    catch { return { shopName: 'Shree Kirana Store', ownerName: 'Shopkeeper', phone: '', address: '', language: 'Hindi', currency: 'INR', lowStock: 5, reminders: true, sound: true } }
  })
  const [settingsSaved, setSettingsSaved] = useState(false)


  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const [voiceLanguage, setVoiceLanguage] = useState('')
  const [voiceError, setVoiceError] = useState('')
  const [parsedTransaction, setParsedTransaction] =
    useState<ParsedVoiceTransaction | null>(null)
  const [isParsing, setIsParsing] = useState(false)
  const [isSavingTransaction, setIsSavingTransaction] = useState(false)
  const [parseError, setParseError] = useState('')
  const [draftCustomerId, setDraftCustomerId] = useState<number | ''>('')
  const [draftProductId, setDraftProductId] = useState<number | ''>('')
  const [draftTransactionType, setDraftTransactionType] =
    useState<'Credit' | 'Payment' | ''>('')
  const [draftAmount, setDraftAmount] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const audioChunksRef = useRef<Float32Array[]>([])
  // Keep the same id when the exact same draft is retried after a network error.
  const pendingVoiceRequestIdRef = useRef<string | null>(null)
  const pendingVoicePayloadSignatureRef = useRef<string | null>(null)
  // Preserve the idempotency key if a manual ledger save needs to be retried.
  const pendingManualRequestIdRef = useRef<string | null>(null)
  const pendingManualPayloadSignatureRef = useRef<string | null>(null)


  const [customers, setCustomers] = useState<Customer[]>(() => {
    try {
      const savedCustomers = localStorage.getItem('khatavoice_customers')

      if (savedCustomers) {
        const parsedCustomers: unknown = JSON.parse(savedCustomers)

        if (Array.isArray(parsedCustomers)) {
          return parsedCustomers.map((customer) => ({
            ...customer,
            openingBalance: Number(
              customer.openingBalance ?? customer.balance ?? 0,
            ),
          })) as Customer[]
        }
      }
    } catch (error) {
      console.error('Could not load saved customers:', error)
    }

    return initialCustomers
  })

  useEffect(() => {
    try {
      localStorage.setItem('khatavoice_customers', JSON.stringify(customers))
    } catch (error) {
      console.error('Could not save customers:', error)
    }
  }, [customers])
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [formError, setFormError] = useState('')

  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    try {
      const savedTransactions = localStorage.getItem('khatavoice_transactions')
      if (savedTransactions) {
        const parsed: unknown = JSON.parse(savedTransactions)
        if (Array.isArray(parsed)) return parsed as Transaction[]
      }
    } catch (error) {
      console.error('Could not load saved transactions:', error)
    }
    return initialTransactions
  })

  useEffect(() => {
    try {
      localStorage.setItem('khatavoice_transactions', JSON.stringify(transactions))
    } catch (error) {
      console.error('Could not save transactions:', error)
    }
  }, [transactions])

  // Product catalogue state
  const [products, setProducts] = useState<Product[]>(() => {
    try {
      const savedProducts = localStorage.getItem('khatavoice_products')

      if (savedProducts) {
        const parsedProducts: unknown = JSON.parse(savedProducts)

        if (Array.isArray(parsedProducts)) {
          return parsedProducts as Product[]
        }
      }
    } catch (error) {
      console.error('Could not load saved products:', error)
    }

    return initialProducts
  })

  useEffect(() => {
    try {
      localStorage.setItem('khatavoice_products', JSON.stringify(products))
    } catch (error) {
      console.error('Could not save products:', error)
    }
  }, [products])

  // Derive notification items only after customer and product state exists.
  const notifications = useMemo(() => [
    ...customers
      .filter((customer) => customer.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 3)
      .map((customer) => ({
        id: `balance-${customer.id}`,
        title: `${customer.name} has an outstanding balance`,
        detail: `${money(customer.balance)} is pending in their khata.`,
        kind: 'balance' as const,
      })),
    ...products
      .filter((product) => product.stock <= Number(shopSettings.lowStock || 5))
      .map((product) => ({
        id: `stock-${product.id}`,
        title: `Low stock: ${product.name}`,
        detail: `Only ${product.stock} ${product.unit} remaining.`,
        kind: 'stock' as const,
      })),
  ], [customers, products, shopSettings.lowStock])
  const unreadCount = notifications.filter((notification) => !readNotifications.includes(notification.id)).length
  const markAllRead = () => {
    const ids = notifications.map((notification) => notification.id)
    setReadNotifications(ids)
    localStorage.setItem('khatavoice_read_notifications', JSON.stringify(ids))
  }
  const saveSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    localStorage.setItem('khatavoice_settings', JSON.stringify(shopSettings))
    setSettingsSaved(true)
    window.setTimeout(() => setSettingsSaved(false), 2500)
  }
  const [showProductForm, setShowProductForm] = useState(false)
  const [editingProductId, setEditingProductId] = useState<number | null>(null)
  const [productName, setProductName] = useState('')
  const [productCategory, setProductCategory] = useState('Essentials')
  const [productUnit, setProductUnit] = useState('kg')
  const [productPrice, setProductPrice] = useState('')
  const [productStock, setProductStock] = useState('')
  const [productError, setProductError] = useState('')
  const [isSavingProduct, setIsSavingProduct] = useState(false)

  // Customer ledger state
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>(() => {
    try {
      const savedEntries = localStorage.getItem('khatavoice_ledger_entries')

      if (savedEntries) {
        const parsedEntries: unknown = JSON.parse(savedEntries)

        if (Array.isArray(parsedEntries)) {
          return parsedEntries as LedgerEntry[]
        }
      }
    } catch (error) {
      console.error('Could not load saved ledger entries:', error)
    }

    return []
  })

  useEffect(() => {
    try {
      localStorage.setItem('khatavoice_ledger_entries', JSON.stringify(ledgerEntries))
    } catch (error) {
      console.error('Could not save ledger entries:', error)
    }
  }, [ledgerEntries])
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null)
  const [showLedgerForm, setShowLedgerForm] = useState(false)
  const [ledgerType, setLedgerType] = useState<'Credit' | 'Payment'>('Credit')
  const [ledgerAmount, setLedgerAmount] = useState('')
  const [ledgerDescription, setLedgerDescription] = useState('')
  const [ledgerError, setLedgerError] = useState('')

  // Load the latest customers, products and transaction history from Supabase.
  // Local Storage remains available as a fallback if the backend is offline.
  useEffect(() => {
    let isActive = true

    const loadDatabaseData = async () => {
      try {
        const [customersResponse, productsResponse, transactionsResponse] =
          await Promise.all([
            fetch('https://khatavoice-ai.onrender.com/api/customers'),
            fetch('https://khatavoice-ai.onrender.com/api/products'),
            fetch('https://khatavoice-ai.onrender.com/api/transactions'),
          ])

        if (
          !customersResponse.ok ||
          !productsResponse.ok ||
          !transactionsResponse.ok
        ) {
          throw new Error('Could not load database records.')
        }

        const [customersResult, productsResult, transactionsResult] =
          await Promise.all([
            customersResponse.json(),
            productsResponse.json(),
            transactionsResponse.json(),
          ])

        if (
          !customersResult.success ||
          !productsResult.success ||
          !transactionsResult.success
        ) {
          throw new Error('The database returned an unsuccessful response.')
        }

        if (!isActive) return

        const databaseCustomers: Customer[] = customersResult.data.map(
          (item: {
            id: number
            name: string
            phone: string
            balance: number | string
            opening_balance?: number | string | null
            initials?: string | null
          }) => ({
            id: Number(item.id),
            name: item.name,
            phone: item.phone,
            balance: Number(item.balance),
            openingBalance: Number(item.opening_balance ?? 0),
            initials:
              item.initials ||
              item.name
                .split(/\s+/)
                .filter(Boolean)
                .map((part: string) => part[0])
                .join('')
                .slice(0, 2)
                .toUpperCase(),
          }),
        )

        const databaseProducts: Product[] = productsResult.data.map(
          (item: {
            id: number
            name: string
            category: string
            unit: string
            price: number | string
            stock: number | string
          }) => ({
            id: Number(item.id),
            name: item.name,
            category: item.category,
            unit: item.unit,
            price: Number(item.price),
            stock: Number(item.stock),
          }),
        )

        const customerNames = new Map<number, string>(
          databaseCustomers.map((customer) => [
            customer.id,
            customer.name,
          ]),
        )

        const databaseTransactions: Transaction[] =
          transactionsResult.data.map(
            (item: {
              id: number
              customer_id: number
              description: string
              transaction_type: 'Credit' | 'Payment'
              amount: number | string
              created_at: string
            }) => ({
              id: Number(item.id),
              customer:
                customerNames.get(Number(item.customer_id)) ??
                'Unknown customer',
              description: item.description,
              type: item.transaction_type,
              amount: Number(item.amount),
              date: new Date(item.created_at).toLocaleString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              }),
            }),
          )

        const databaseLedgerEntries: LedgerEntry[] =
          transactionsResult.data.map(
            (item: {
              id: number
              customer_id: number
              description: string
              transaction_type: 'Credit' | 'Payment'
              amount: number | string
              created_at: string
            }) => ({
              id: Number(item.id),
              customerId: Number(item.customer_id),
              description: item.description,
              type: item.transaction_type,
              amount: Number(item.amount),
              createdAt: item.created_at,
              date: new Date(item.created_at).toLocaleString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              }),
            }),
          )

        setCustomers(databaseCustomers)
        setProducts(databaseProducts)
        setTransactions(databaseTransactions)
        setLedgerEntries(databaseLedgerEntries)

        console.log('KhataVoice AI: Supabase data loaded successfully.')
      } catch (error) {
        console.error(
          'KhataVoice AI: Could not load Supabase data. Using local data as fallback.',
          error,
        )
      }
    }

    void loadDatabaseData()

    return () => {
      isActive = false
    }
  }, [])


  const parseVoiceTranscript = async (transcript: string) => {
    setIsParsing(true)
    setParseError('')
    setParsedTransaction(null)

    try {
      const response = await fetch('https://khatavoice-ai.onrender.com/api/parse-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript,
          customers: customers.map(({ id, name }) => ({ id, name })),
          products: products.map(({ id, name, category, unit, price }) => ({
            id, name, category, unit, price,
          })),
        }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.detail || 'Could not understand this transaction.')
      }

      const parsed = result as ParsedVoiceTransaction
      setParsedTransaction(parsed)
      setDraftCustomerId(parsed.customer?.id ?? '')
      setDraftProductId(parsed.product?.id ?? '')
      setDraftTransactionType(parsed.transaction_type ?? '')
      setDraftAmount(parsed.amount !== null ? String(parsed.amount) : '')
      setDraftDescription(parsed.product?.name ?? transcript)
    } catch (error) {
      console.error('Transaction parsing error:', error)
      setParseError(
        error instanceof Error ? error.message : 'Could not parse the transaction.',
      )
    } finally {
      setIsParsing(false)
    }
  }

  const startVoiceRecording = async () => {
    setVoiceError('')
    setVoiceTranscript('')
    setVoiceLanguage('')
    setParsedTransaction(null)
    pendingVoiceRequestIdRef.current = null
    pendingVoicePayloadSignatureRef.current = null
    setParseError('')
    setVoiceError('')

    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError('Your browser does not support microphone recording. Please use an updated version of Chrome.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const audioContext = new AudioContext({ sampleRate: 44100 })
      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)

      audioChunksRef.current = []
      audioStreamRef.current = stream
      audioContextRef.current = audioContext
      processorRef.current = processor

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0)
        audioChunksRef.current.push(new Float32Array(input))
        event.outputBuffer.getChannelData(0).fill(0)
      }

      source.connect(processor)
      processor.connect(audioContext.destination)
      setIsRecording(true)
    } catch (error) {
      console.error('Could not start microphone:', error)
      setVoiceError('Microphone access was blocked. Allow microphone permission in your browser and try again.')
    }
  }

  const stopVoiceRecording = async () => {
    const audioContext = audioContextRef.current
    const stream = audioStreamRef.current
    const processor = processorRef.current

    if (!audioContext || !stream || !processor) {
      setVoiceError('No active recording was found. Please try again.')
      setIsRecording(false)
      return
    }

    setIsRecording(false)
    processor.disconnect()
    stream.getTracks().forEach((track) => track.stop())

    const chunks = audioChunksRef.current
    const sampleRate = audioContext.sampleRate

    try {
      await audioContext.close()
    } catch (error) {
      console.warn('Audio context close warning:', error)
    }

    audioContextRef.current = null
    audioStreamRef.current = null
    processorRef.current = null
    audioChunksRef.current = []

    if (chunks.length === 0) {
      setVoiceError('No audio was captured. Please record again.')
      return
    }

    const audioBlob = encodeWav(chunks, sampleRate)
    const formData = new FormData()
    formData.append('audio', audioBlob, 'khatavoice-recording.wav')

    setIsTranscribing(true)
    setVoiceError('')

    try {
      const response = await fetch('https://khatavoice-ai.onrender.com/api/transcribe', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.detail || 'Transcription failed. Please try again.')
      }

      if (!result.transcript) {
        throw new Error('Gnani returned an empty transcript. Please speak clearly and try again.')
      }

      setVoiceTranscript(result.transcript)
      setVoiceLanguage(result.detected_language || 'Language not identified')
      await parseVoiceTranscript(result.transcript)
    } catch (error) {
      console.error('Transcription error:', error)
      setVoiceError(error instanceof Error ? error.message : 'Could not transcribe the recording.')
    } finally {
      setIsTranscribing(false)
    }
  }

  useEffect(() => {
    return () => {
      processorRef.current?.disconnect()
      audioStreamRef.current?.getTracks().forEach((track) => track.stop())
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        void audioContextRef.current.close()
      }
    }
  }, [])

  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId)

  const selectedLedgerEntries = ledgerEntries.filter(
    (entry) => entry.customerId === selectedCustomerId,
  )

  // Always calculate balances oldest-to-newest, independently of display order.
  // The ledger UI can then show newest entries first without reversing the math.
  const chronologicalLedgerEntries = [...selectedLedgerEntries].sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : Date.parse(a.date)
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : Date.parse(b.date)

    if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
      return timeA - timeB
    }

    return a.id - b.id
  })

  // Reconcile a missing/stale opening_balance field against the authoritative
  // current balance and the complete transaction history.
  const ledgerNetChange = chronologicalLedgerEntries.reduce(
    (total, entry) =>
      total + (entry.type === 'Credit' ? entry.amount : -entry.amount),
    0,
  )
  const derivedOpeningBalance = selectedCustomer
    ? Math.round((selectedCustomer.balance - ledgerNetChange) * 100) / 100
    : 0
  const apiOpeningBalance = selectedCustomer?.openingBalance ?? 0
  const openingBalance =
    Math.abs(apiOpeningBalance - derivedOpeningBalance) > 0.01
      ? derivedOpeningBalance
      : apiOpeningBalance

  const ledgerBalanceAfterEntry = new Map<number, number>()
  let calculatedLedgerBalance = openingBalance

  for (const entry of chronologicalLedgerEntries) {
    calculatedLedgerBalance +=
      entry.type === 'Credit' ? entry.amount : -entry.amount
    ledgerBalanceAfterEntry.set(entry.id, calculatedLedgerBalance)
  }

  const filteredCustomers = useMemo(
    () =>
      customers.filter((customer) =>
        `${customer.name} ${customer.phone}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [customers, search],
  )

  const filteredTransactions = useMemo(
    () =>
      transactions.filter((transaction) =>
        `${transaction.customer} ${transaction.description} ${transaction.type}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [transactions, search],
  )

  const filteredProducts = useMemo(
    () => products.filter((product) =>
      `${product.name} ${product.category} ${product.unit}`.toLowerCase().includes(search.toLowerCase()),
    ),
    [products, search],
  )

  const totalOutstanding = customers.reduce((total, customer) => total + customer.balance, 0)
  const activeCustomers = customers.filter((customer) => customer.balance > 0).length

  const handleNavigation = (page: string) => {
    setActivePage(page)
    setSearch('')
    setMobileMenuOpen(false)
    if (page !== 'Ledger') setSelectedCustomerId(null)
  }

  const openCustomerLedger = (customerId: number) => {
    setSelectedCustomerId(customerId)
    setSearch('')
    setActivePage('Ledger')
    setMobileMenuOpen(false)
  }

  const handleAddCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const name = newCustomerName.trim()
    const phone = newCustomerPhone.replace(/\D/g, '')

    if (!name || !phone) {
      setFormError('Please enter the customer name and phone number.')
      return
    }

    if (!/^\d{10}$/.test(phone)) {
      setFormError('Please enter a valid 10-digit phone number.')
      return
    }

    if (customers.some((customer) => customer.phone.replace(/\D/g, '') === phone)) {
      setFormError('A customer with this phone number already exists.')
      return
    }

    setFormError('')

    try {
      const response = await fetch('https://khatavoice-ai.onrender.com/api/customers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, phone }),
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.detail || 'Could not save customer.')
      }

      const savedCustomer: Customer = {
        id: Number(result.data.id),
        name: result.data.name,
        phone: result.data.phone,
        balance: Number(result.data.balance),
        openingBalance: Number(result.data.opening_balance ?? 0),
        initials: result.data.initials || name
          .split(/\s+/)
          .filter(Boolean)
          .map((part: string) => part[0])
          .join('')
          .slice(0, 2)
          .toUpperCase(),
      }

      setCustomers((previous) => [savedCustomer, ...previous])
      setNewCustomerName('')
      setNewCustomerPhone('')
      setFormError('')
      setShowAddCustomer(false)
    } catch (error) {
      console.error('Add customer error:', error)
      setFormError(
        error instanceof Error
          ? error.message
          : 'Could not save customer. Please try again.',
      )
    }
  }

  const closeAddCustomer = () => {
    setShowAddCustomer(false)
    setNewCustomerName('')
    setNewCustomerPhone('')
    setFormError('')
  }

  const openProductForm = (product?: Product) => {
    setEditingProductId(product?.id ?? null)
    setProductName(product?.name ?? '')
    setProductCategory(product?.category ?? 'Essentials')
    setProductUnit(product?.unit ?? 'kg')
    setProductPrice(product ? String(product.price) : '')
    setProductStock(product ? String(product.stock) : '')
    setProductError('')
    setShowProductForm(true)
  }

  const closeProductForm = () => {
    setShowProductForm(false)
    setEditingProductId(null)
    setProductName('')
    setProductPrice('')
    setProductStock('')
    setProductError('')
  }

  const handleSaveProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSavingProduct) return

    const name = productName.trim()
    const price = Number(productPrice)
    const stock = Number(productStock)

    if (!name || !productPrice || !productStock || !Number.isFinite(price) || price <= 0 || !Number.isFinite(stock) || stock < 0) {
      setProductError('Enter a product name, a price greater than zero and a valid stock quantity.')
      return
    }

    const duplicate = products.some((product) =>
      product.name.toLowerCase() === name.toLowerCase() && product.id !== editingProductId,
    )
    if (duplicate) {
      setProductError('A product with this name already exists.')
      return
    }

    const productPayload = {
      name,
      category: productCategory,
      unit: productUnit,
      price: Math.round(price * 100) / 100,
      stock,
    }

    setIsSavingProduct(true)
    setProductError('')

    try {
      const isEditing = editingProductId !== null
      const endpoint = isEditing
        ? `https://khatavoice-ai.onrender.com/api/products/${editingProductId}`
        : 'https://khatavoice-ai.onrender.com/api/products'

      const response = await fetch(endpoint, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productPayload),
      })
      const result = await response.json()

      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.detail || result.message || 'Could not save the product to Supabase.')
      }

      const savedProduct: Product = {
        id: Number(result.data.id),
        name: result.data.name,
        category: result.data.category,
        unit: result.data.unit,
        price: Number(result.data.price),
        stock: Number(result.data.stock),
      }

      if (isEditing) {
        setProducts((previous) =>
          previous.map((product) => product.id === savedProduct.id ? savedProduct : product),
        )
      } else {
        setProducts((previous) => [savedProduct, ...previous])
      }

      closeProductForm()
    } catch (error) {
      console.error('Save product error:', error)
      setProductError(error instanceof Error ? error.message : 'Could not save the product. Please try again.')
    } finally {
      setIsSavingProduct(false)
    }
  }

  const deleteProduct = async (id: number) => {
    const product = products.find((item) => item.id === id)
    if (!product || !window.confirm(`Delete ${product.name} from your catalogue?`)) return

    try {
      const response = await fetch(`https://khatavoice-ai.onrender.com/api/products/${id}`, {
        method: 'DELETE',
      })
      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.detail || result.message || 'Could not delete the product from Supabase.')
      }

      setProducts((previous) => previous.filter((item) => item.id !== id))
    } catch (error) {
      console.error('Delete product error:', error)
      window.alert(error instanceof Error ? error.message : 'Could not delete the product. Please try again.')
    }
  }

  const openLedgerForm = (type: 'Credit' | 'Payment') => {
    setLedgerType(type)
    setLedgerAmount('')
    setLedgerDescription('')
    setLedgerError('')
    pendingManualRequestIdRef.current = null
    pendingManualPayloadSignatureRef.current = null
    setShowLedgerForm(true)
  }

  const handleLedgerTransaction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (isSavingTransaction) return

    if (!selectedCustomer) {
      setLedgerError('Please select a customer.')
      return
    }

    const amount = Number(ledgerAmount)
    const description =
      ledgerDescription.trim() ||
      (ledgerType === 'Credit' ? 'Credit added' : 'Payment received')

    if (!Number.isFinite(amount) || amount <= 0) {
      setLedgerError('Enter a valid amount greater than zero.')
      return
    }

    if (ledgerType === 'Payment' && amount > selectedCustomer.balance) {
      setLedgerError('Payment cannot exceed the customer outstanding balance.')
      return
    }

    const transactionPayload = {
      customer_id: selectedCustomer.id,
      product_id: null,
      description,
      transaction_type: ledgerType,
      amount: Math.round(amount * 100) / 100,
      quantity: null,
      original_transcript: `Manual ${ledgerType.toLowerCase()} entry: ${description}`,
      detected_language: null,
    }

    // Reuse the same key for an unchanged retry to prevent duplicate entries.
    const payloadSignature = JSON.stringify(transactionPayload)
    if (
      !pendingManualRequestIdRef.current ||
      pendingManualPayloadSignatureRef.current !== payloadSignature
    ) {
      pendingManualRequestIdRef.current = crypto.randomUUID()
      pendingManualPayloadSignatureRef.current = payloadSignature
    }

    setIsSavingTransaction(true)
    setLedgerError('')

    try {
      const response = await fetch('https://khatavoice-ai.onrender.com/api/confirm-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...transactionPayload,
          request_id: pendingManualRequestIdRef.current,
        }),
      })

      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.detail || 'The transaction could not be saved. Please try again.')
      }

      const rpcData = Array.isArray(result.data) ? result.data[0] : result.data
      const databaseTransactionId = Number(rpcData?.transaction_id)
      const databaseBalance = Number(rpcData?.new_balance)

      if (!Number.isFinite(databaseTransactionId) || databaseTransactionId <= 0) {
        throw new Error('The database response did not include a valid transaction ID. Please check the transaction history before retrying.')
      }
      if (!Number.isFinite(databaseBalance)) {
        throw new Error('The database response did not include the updated customer balance. Please refresh the customer list before retrying.')
      }

      const date = new Date().toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })

      const entry: LedgerEntry = {
        id: databaseTransactionId,
        customerId: selectedCustomer.id,
        description,
        type: ledgerType,
        amount: transactionPayload.amount,
        createdAt: new Date().toISOString(),
        date,
      }

      const transaction: Transaction = {
        id: databaseTransactionId,
        customer: selectedCustomer.name,
        description,
        type: ledgerType,
        amount: transactionPayload.amount,
        date,
      }

      setCustomers((previous) =>
        previous.map((customer) =>
          customer.id === selectedCustomer.id
            ? { ...customer, balance: databaseBalance }
            : customer,
        ),
      )
      setLedgerEntries((previous) => [...previous, entry])
      setTransactions((previous) => [transaction, ...previous])
      setSelectedCustomerId(selectedCustomer.id)
      setShowLedgerForm(false)
      setLedgerAmount('')
      setLedgerDescription('')
      setLedgerError('')
      pendingManualRequestIdRef.current = null
      pendingManualPayloadSignatureRef.current = null
    } catch (error) {
      console.error('Manual ledger transaction save error:', error)
      setLedgerError(
        error instanceof Error
          ? error.message
          : 'Could not save the transaction. Please try again.',
      )
    } finally {
      setIsSavingTransaction(false)
    }
  }

  const handleConfirmVoiceTransaction = async () => {
    if (isSavingTransaction) return

    const customer = customers.find(
      (item) => item.id === Number(draftCustomerId),
    )
    const amount = Number(draftAmount)

    if (!customer) {
      setParseError('Please select the correct customer.')
      return
    }
    if (!draftTransactionType) {
      setParseError('Please select Credit or Payment.')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setParseError('Enter a valid amount greater than zero.')
      return
    }
    if (draftTransactionType === 'Payment' && amount > customer.balance) {
      setParseError('Payment cannot exceed the customer outstanding balance.')
      return
    }

    const selectedProduct = products.find(
      (product) => product.id === Number(draftProductId),
    )

    // Reject an over-stock voice credit before sending it to the API.
    // The backend/database must still enforce stock as the authoritative check.
    const requestedQuantity = parsedTransaction?.quantity ?? null
    if (
      draftTransactionType === 'Credit' &&
      selectedProduct &&
      requestedQuantity !== null &&
      requestedQuantity > selectedProduct.stock
    ) {
      setParseError(
        `Insufficient stock: only ${selectedProduct.stock} ${selectedProduct.unit} of ${selectedProduct.name} is available, but you requested ${requestedQuantity} ${selectedProduct.unit}. Reduce the quantity and try again.`,
      )
      return
    }

    const description =
      draftDescription.trim() || selectedProduct?.name || 'Voice transaction'

    const transactionPayload = {
      customer_id: customer.id,
      product_id: selectedProduct?.id ?? null,
      description,
      transaction_type: draftTransactionType,
      amount: Math.round(amount * 100) / 100,
      quantity: parsedTransaction?.quantity ?? null,
      original_transcript: parsedTransaction?.transcript ?? voiceTranscript,
      detected_language: voiceLanguage || null,
    }

    // If the user retries the exact same draft, reuse its request ID.
    // If they changed any field, generate a fresh ID for the changed transaction.
    const payloadSignature = JSON.stringify(transactionPayload)
    if (
      !pendingVoiceRequestIdRef.current ||
      pendingVoicePayloadSignatureRef.current !== payloadSignature
    ) {
      pendingVoiceRequestIdRef.current = crypto.randomUUID()
      pendingVoicePayloadSignatureRef.current = payloadSignature
    }
    const requestId = pendingVoiceRequestIdRef.current!

    setIsSavingTransaction(true)
    setParseError('')

    try {
      // Save to PostgreSQL first. Only update the UI after the database confirms.
      const response = await fetch('https://khatavoice-ai.onrender.com/api/confirm-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...transactionPayload,
          request_id: requestId,
        }),
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(
          result.detail || 'The transaction could not be saved. Please try again.',
        )
      }

      // The database function returns the inserted transaction ID and new balance.
      const rpcData = Array.isArray(result.data) ? result.data[0] : result.data
      const databaseTransactionId = Number(rpcData?.transaction_id)
      const databaseBalance = Number(rpcData?.new_balance)

      const entryId =
        Number.isFinite(databaseTransactionId) && databaseTransactionId > 0
          ? databaseTransactionId
          : Date.now()

      const newBalance = Number.isFinite(databaseBalance)
        ? databaseBalance
        : Math.round(
            (draftTransactionType === 'Credit'
              ? customer.balance + amount
              : customer.balance - amount) * 100,
          ) / 100

      const date = new Date().toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })

      const entry: LedgerEntry = {
        id: entryId,
        customerId: customer.id,
        description,
        type: draftTransactionType,
        amount: Math.round(amount * 100) / 100,
        date,
        createdAt: new Date().toISOString(),
      }

      const transaction: Transaction = {
        id: entryId,
        customer: customer.name,
        description,
        type: draftTransactionType,
        amount: Math.round(amount * 100) / 100,
        date,
      }

      setCustomers((previous) =>
        previous.map((item) =>
          item.id === customer.id
            ? { ...item, balance: newBalance }
            : item,
        ),
      )
      setLedgerEntries((previous) => [...previous, entry])
      setTransactions((previous) => [transaction, ...previous])
      setSelectedCustomerId(customer.id)
      setActivePage('Ledger')
      setParsedTransaction(null)
      pendingVoiceRequestIdRef.current = null
      pendingVoicePayloadSignatureRef.current = null
      setParseError('')
      setVoiceError('')
    } catch (error) {
      console.error('Transaction save error:', error)
      setParseError(
        error instanceof Error
          ? error.message
          : 'Could not save the transaction. Please try again.',
      )
    } finally {
      setIsSavingTransaction(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f9f6] text-slate-800">
      {mobileMenuOpen && (
        <button
          aria-label="Close navigation"
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-20 items-center justify-between border-b border-slate-100 px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-green-800 text-white">
              <ShoppingBag size={23} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-green-950">KhataVoice AI</h1>
              <p className="text-xs text-slate-500">Speak. Record. Track. Grow.</p>
            </div>
          </div>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-4 py-6">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Workspace
          </p>
          <nav className="space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon
              const selected = activePage === item.name
              return (
                <button
                  key={item.name}
                  onClick={() => handleNavigation(item.name)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition ${
                    selected
                      ? 'bg-green-50 text-green-800'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon size={19} />
                  {item.name}
                  {selected && <span className="ml-auto h-2 w-2 rounded-full bg-green-700" />}
                </button>
              )
            })}
          </nav>
        </div>

        <div className="mt-auto p-4">
          <div className="rounded-2xl bg-green-50 p-4">
            <div className="mb-2 flex items-center gap-2 text-green-800">
              <CircleHelp size={18} />
              <span className="text-sm font-semibold">Need help?</span>
            </div>
            <p className="text-xs leading-5 text-slate-600">
              Your digital khata assistant is here to help you manage your shop.
            </p>
            <button
              onClick={() => setVoiceInfoOpen((open) => !open)}
              className="mt-3 text-xs font-semibold text-green-800 hover:underline"
            >
              Learn more
            </button>
          </div>
          <button onClick={onSignOut} className="mt-4 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-500 hover:bg-slate-50">
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>

      <div className="min-h-screen lg:pl-64">
        <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg p-2 hover:bg-slate-100 lg:hidden"
              aria-label="Open menu"
            >
              <Menu size={21} />
            </button>
            <div>
              <p className="text-sm font-semibold text-slate-800">{activePage}</p>
              <p className="hidden text-xs text-slate-500 sm:block">
                Welcome back! Here's what's happening at your shop.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-5">
            <div className="relative">
              <button onClick={() => setNotificationsOpen(v=>!v)} aria-label="Notifications" className="relative rounded-full p-2 text-slate-500 hover:bg-slate-100">
                <Bell size={20} />
                {unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unreadCount}</span>}
              </button>
              {notificationsOpen && <div className="absolute right-0 z-50 mt-3 w-[min(92vw,360px)] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
                <div className="flex items-center justify-between"><h3 className="font-bold text-slate-900">Notifications</h3><button onClick={markAllRead} className="text-xs font-semibold text-green-700">Mark all read</button></div>
                <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">{notifications.length ? notifications.map(n=><button key={n.id} onClick={()=>{const ids=[...readNotifications,n.id];setReadNotifications(ids);localStorage.setItem('khatavoice_read_notifications',JSON.stringify(ids))}} className={`w-full rounded-xl p-3 text-left ${readNotifications.includes(n.id)?'bg-slate-50':'bg-green-50'}`}><p className="text-sm font-semibold text-slate-800">{n.title}</p><p className="mt-1 text-xs text-slate-500">{n.detail}</p></button>) : <p className="py-6 text-center text-sm text-slate-500">You're all caught up.</p>}</div>
                <button onClick={()=>setNotificationsOpen(false)} className="mt-3 w-full rounded-lg border border-slate-200 py-2 text-sm">Close</button>
              </div>}
            </div>
            <div className="hidden h-8 w-px bg-slate-200 sm:block" />
            <button className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-100 text-sm font-bold text-green-800">
                SK
              </div>
              <div className="hidden text-left sm:block">
                <p className="text-sm font-semibold text-slate-800">{shopSettings.shopName}</p>
                <p className="text-xs text-slate-500">{userEmail || shopSettings.ownerName}</p>
              </div>
              <ChevronDown size={16} className="hidden text-slate-400 sm:block" />
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-7xl space-y-7 p-4 sm:p-8">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm font-medium text-green-700">
                {new Date().toLocaleDateString('en-IN', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                {activePage === 'Dashboard'
                  ? 'Your shop at a glance'
                  : activePage === 'Ledger'
                    ? 'Customer ledger'
                    : activePage}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {activePage === 'Dashboard'
                  ? 'Keep track of your customers and daily business.'
                  : activePage === 'Ledger'
                    ? 'View and manage this customer’s credit and payments.'
                    : `Manage your shop's ${activePage.toLowerCase()}.`}
              </p>
            </div>

            {activePage !== 'Ledger' && (
              <div className="relative w-full sm:max-w-xs">
                <Search
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={`Search ${activePage.toLowerCase()}...`}
                  className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm outline-none transition focus:border-green-600 focus:ring-2 focus:ring-green-100"
                />
              </div>
            )}
          </div>

          {activePage === 'Dashboard' && (
            <>
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  title="Total outstanding"
                  value={money(totalOutstanding)}
                  detail="Customer credit balance"
                  icon={<Wallet size={21} />}
                  color="green"
                />
                <StatCard
                  title="Collected today"
                  value={money(1250)}
                  detail="Payments received"
                  icon={<ArrowDownLeft size={21} />}
                  color="blue"
                />
                <StatCard
                  title="Credit given today"
                  value={money(730)}
                  detail="New credit transactions"
                  icon={<ArrowUpRight size={21} />}
                  color="orange"
                />
                <StatCard
                  title="Active customers"
                  value={String(activeCustomers)}
                  detail={`${customers.length} customers in total`}
                  icon={<Users size={21} />}
                  color="purple"
                />
              </section>

              <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-green-900 via-green-800 to-green-700 p-6 text-white shadow-sm sm:p-8">
                <div className="flex flex-col items-center justify-between gap-7 md:flex-row">
                  <div className="max-w-lg">
                    <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-green-50">
                      YOUR VOICE ASSISTANT
                    </span>
                    <h3 className="mt-4 text-2xl font-bold sm:text-3xl">
                      Your khata, just a conversation away.
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-green-100">
                      Speak naturally in your language. Add customer credit, record payments and
                      manage your shop with your voice.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2 text-xs text-green-50">
                      {['Hindi', 'Marathi', 'English', 'Hinglish'].map((language) => (
                        <span key={language} className="rounded-full bg-white/10 px-3 py-2">
                          {language}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-center">
                    <button
                      onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
                      disabled={isTranscribing}
                      className={`flex h-24 w-24 items-center justify-center rounded-full shadow-xl transition hover:scale-105 focus:outline-none focus:ring-4 focus:ring-white/30 disabled:cursor-wait disabled:opacity-60 ${
                        isRecording
                          ? 'bg-red-500 text-white hover:bg-red-600'
                          : 'bg-white text-green-800 hover:bg-green-50'
                      }`}
                      aria-label={isRecording ? 'Stop recording' : 'Start voice recording'}
                    >
                      {isRecording ? <Square size={30} /> : <Mic size={38} />}
                    </button>
                    <p className="mt-4 text-sm font-semibold">
                      {isRecording
                        ? 'Recording… click to stop'
                        : isTranscribing
                          ? 'Transcribing your voice…'
                          : 'Start with your voice'}
                    </p>
                    <p className="mt-1 text-xs text-green-100">
                      {isRecording
                        ? 'Speak now, then press the button to finish'
                        : 'Hindi · Marathi · English · Hinglish'}
                    </p>
                  </div>
                </div>

                <div className="mt-6 space-y-3">
                  {voiceError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                      {voiceError}
                    </div>
                  )}

                  {isTranscribing && (
                    <div className="rounded-xl border border-white/20 bg-white/10 p-4 text-sm text-green-50">
                      Sending your recording securely to Gnani Prisma v3.0…
                    </div>
                  )}

                  {voiceTranscript && (
                    <div className="rounded-xl border border-white/20 bg-white/10 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-white">Recognised speech</p>
                        <span className="rounded-full bg-white/15 px-3 py-1 text-xs text-green-50">
                          {voiceLanguage}
                        </span>
                      </div>
                      <p className="mt-3 text-base leading-7 text-white">{voiceTranscript}</p>
                      <p className="mt-3 text-xs text-green-100">
                        Review this transcript before creating a ledger transaction. Nothing has
                        been saved to a customer's account yet.
                      </p>
                    </div>
                  )}

                  {isParsing && (
                    <div className="rounded-xl border border-white/20 bg-white/10 p-4 text-sm text-green-50">
                      Understanding the customer, product and transaction…
                    </div>
                  )}

                  {parseError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                      {parseError}
                    </div>
                  )}

                  {parsedTransaction && (
                    <div className="rounded-2xl bg-white p-5 text-slate-800 shadow-lg">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-lg font-bold">Review transaction</h3>
                          <p className="mt-1 text-xs text-slate-500">
                            Check and correct the details before updating the khata.
                          </p>
                        </div>
                        <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">
                          Draft · Not saved
                        </span>
                      </div>

                      <div className="mt-5 grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm font-medium">Customer</label>
                          <select
                            value={draftCustomerId}
                            onChange={(event) => setDraftCustomerId(event.target.value ? Number(event.target.value) : '')}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"
                          >
                            <option value="">Select customer</option>
                            {customers.map((customer) => (
                              <option key={customer.id} value={customer.id}>{customer.name}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium">Product (optional)</label>
                          <select
                            value={draftProductId}
                            onChange={(event) => setDraftProductId(event.target.value ? Number(event.target.value) : '')}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"
                          >
                            <option value="">Select product</option>
                            {products.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.name} · {money(product.price)}/{product.unit}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium">Transaction type</label>
                          <select
                            value={draftTransactionType}
                            onChange={(event) => setDraftTransactionType(event.target.value as 'Credit' | 'Payment' | '')}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"
                          >
                            <option value="">Select type</option>
                            <option value="Credit">Credit — goods given</option>
                            <option value="Payment">Payment — money received</option>
                          </select>
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium">Amount (₹)</label>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={draftAmount}
                            onChange={(event) => setDraftAmount(event.target.value)}
                            placeholder="Enter amount"
                            className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="mb-2 block text-sm font-medium">Description</label>
                          <input
                            value={draftDescription}
                            onChange={(event) => setDraftDescription(event.target.value)}
                            placeholder="Transaction description"
                            className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"
                          />
                        </div>
                      </div>

                      {parsedTransaction.warnings.length > 0 && (
                        <div className="mt-4 rounded-xl bg-orange-50 p-4">
                          <p className="text-sm font-semibold text-orange-800">Please check these details</p>
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-orange-700">
                            {parsedTransaction.warnings.map((warning, index) => (
                              <li key={index}>{warning}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <p className="mt-4 text-xs text-slate-500">
                        Original speech: {parsedTransaction.transcript}
                      </p>

                      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                        <button
                          type="button"
                          onClick={() => {
                              setParsedTransaction(null)
                              pendingVoiceRequestIdRef.current = null
                              pendingVoicePayloadSignatureRef.current = null
                              setParseError('')
                            }}
                          className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          Discard draft
                        </button>
                        <button
                          type="button"
                          onClick={handleConfirmVoiceTransaction}
                          disabled={isSavingTransaction}
                          className="flex-1 rounded-xl bg-green-800 px-4 py-3 text-sm font-semibold text-white hover:bg-green-900 disabled:cursor-wait disabled:opacity-60"
                        >
                          {isSavingTransaction ? 'Saving to Supabase…' : 'Confirm and save transaction'}
                        </button>
                      </div>
                    </div>
                  )}

                  {voiceInfoOpen && (
                    <div className="rounded-xl border border-white/20 bg-white/10 p-4 text-sm text-green-50">
                      Your recording is converted to WAV in the browser and sent to your local
                      FastAPI backend. The backend forwards it to Gnani Prisma v3.0 for transcription.
                      Keep recordings under 30 seconds for this REST integration.
                    </div>
                  )}
                </div>
              </section>

              <section className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-100 p-5">
                    <div>
                      <h3 className="font-bold text-slate-900">Recent transactions</h3>
                      <p className="mt-1 text-xs text-slate-500">Your latest customer activity</p>
                    </div>
                    <button
                      onClick={() => handleNavigation('Transactions')}
                      className="text-xs font-semibold text-green-700 hover:underline"
                    >
                      View all
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {filteredTransactions.slice(0, 5).map((transaction) => (
                      <div
                        key={transaction.id}
                        className="flex items-center justify-between gap-3 px-5 py-4"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                              transaction.type === 'Credit'
                                ? 'bg-orange-50 text-orange-700'
                                : 'bg-green-50 text-green-700'
                            }`}
                          >
                            {transaction.type === 'Credit' ? (
                              <ArrowUpRight size={19} />
                            ) : (
                              <ArrowDownLeft size={19} />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-800">
                              {transaction.customer}
                            </p>
                            <p className="truncate text-xs text-slate-500">
                              {transaction.description} · {transaction.date}
                            </p>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p
                            className={`text-sm font-bold ${
                              transaction.type === 'Credit' ? 'text-orange-700' : 'text-green-700'
                            }`}
                          >
                            {transaction.type === 'Credit' ? '+' : '-'}
                            {money(transaction.amount)}
                          </p>
                          <p className="text-xs text-slate-400">{transaction.type}</p>
                        </div>
                      </div>
                    ))}
                    {filteredTransactions.length === 0 && (
                      <p className="p-6 text-center text-sm text-slate-500">
                        No matching transactions found.
                      </p>
                    )}
                  </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-100 p-5">
                    <div>
                      <h3 className="font-bold text-slate-900">Customer balances</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Customers with outstanding credit
                      </p>
                    </div>
                    <button
                      onClick={() => handleNavigation('Customers')}
                      className="text-xs font-semibold text-green-700 hover:underline"
                    >
                      View all
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {customers
                      .filter((customer) => customer.balance > 0)
                      .slice(0, 5)
                      .map((customer) => (
                        <button
                          key={customer.id}
                          onClick={() => openCustomerLedger(customer.id)}
                          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-green-50/50"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-50 text-xs font-bold text-green-800">
                              {customer.initials}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{customer.name}</p>
                              <p className="text-xs text-slate-500">{customer.phone}</p>
                            </div>
                          </div>
                          <p className="shrink-0 text-sm font-bold text-slate-800">
                            {money(customer.balance)}
                          </p>
                        </button>
                      ))}
                  </div>
                </div>
              </section>
            </>
          )}

          {activePage === 'Customers' && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex flex-col justify-between gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center">
                <div>
                  <h3 className="font-bold text-slate-900">All customers</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {customers.length} customers registered · Select a customer to open their ledger
                  </p>
                </div>
                <button
                  onClick={() => {
                    setFormError('')
                    setShowAddCustomer(true)
                  }}
                  className="flex items-center justify-center gap-2 rounded-xl bg-green-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-900"
                >
                  <Plus size={17} />
                  Add customer
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-4 font-semibold">Customer</th>
                      <th className="px-5 py-4 font-semibold">Phone</th>
                      <th className="px-5 py-4 font-semibold">Outstanding</th>
                      <th className="px-5 py-4 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredCustomers.map((customer) => (
                      <tr
                        key={customer.id}
                        onClick={() => openCustomerLedger(customer.id)}
                        className="cursor-pointer transition hover:bg-green-50"
                        title="Open customer ledger"
                      >
                        <td className="px-5 py-4 font-semibold">{customer.name}</td>
                        <td className="px-5 py-4 text-slate-500">{customer.phone}</td>
                        <td className="px-5 py-4 font-semibold">{money(customer.balance)}</td>
                        <td className="px-5 py-4">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${
                              customer.balance > 0
                                ? 'bg-orange-50 text-orange-700'
                                : 'bg-green-50 text-green-700'
                            }`}
                          >
                            {customer.balance > 0 ? 'Outstanding' : 'Clear'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {filteredCustomers.length === 0 && (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-slate-500">
                          No customers found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activePage === 'Ledger' && selectedCustomer && (
            <section className="space-y-6">
              <button
                onClick={() => handleNavigation('Customers')}
                className="text-sm font-semibold text-green-700 hover:underline"
              >
                ← Back to customers
              </button>

              <div className="rounded-2xl border border-slate-200 bg-white p-6">
                <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-lg font-bold text-green-800">
                      {selectedCustomer.initials}
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">{selectedCustomer.name}</h3>
                      <p className="mt-1 text-sm text-slate-500">{selectedCustomer.phone}</p>
                    </div>
                  </div>
                  <div className="rounded-xl bg-green-50 p-4 sm:min-w-52">
                    <p className="text-xs font-medium text-green-700">Current outstanding</p>
                    <p className="mt-1 text-2xl font-bold text-green-900">
                      {money(selectedCustomer.balance)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <button
                  onClick={() => openLedgerForm('Credit')}
                  className="flex items-center justify-center gap-3 rounded-2xl bg-orange-50 p-5 text-orange-800 transition hover:bg-orange-100"
                >
                  <Plus size={22} />
                  <div className="text-left">
                    <p className="font-bold">Add credit</p>
                    <p className="text-xs">Record goods given on credit</p>
                  </div>
                </button>
                <button
                  onClick={() => openLedgerForm('Payment')}
                  disabled={selectedCustomer.balance <= 0}
                  className="flex items-center justify-center gap-3 rounded-2xl bg-green-50 p-5 text-green-800 transition hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ArrowDownLeft size={22} />
                  <div className="text-left">
                    <p className="font-bold">Record payment</p>
                    <p className="text-xs">Record money received</p>
                  </div>
                </button>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 p-5">
                  <h3 className="font-bold text-slate-900">Customer ledger</h3>
                  <p className="mt-1 text-xs text-slate-500">Credit and payment history</p>
                </div>

                {(() => (
                    <div className="divide-y divide-slate-100">
                      <div className="flex items-center justify-between gap-3 bg-slate-50 px-5 py-4">
                        <div>
                          <p className="text-sm font-semibold text-slate-700">Opening balance</p>
                          <p className="text-xs text-slate-500">
                            Balance before new ledger entries
                          </p>
                        </div>
                        <p className="font-bold text-slate-800">{money(openingBalance)}</p>
                      </div>

                      {[...chronologicalLedgerEntries].reverse().map((entry) => {
                        const runningBalance = ledgerBalanceAfterEntry.get(entry.id) ?? openingBalance

                        return (
                          <div
                            key={entry.id}
                            className="flex items-center justify-between gap-3 px-5 py-4"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <div
                                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                                  entry.type === 'Credit'
                                    ? 'bg-orange-50 text-orange-700'
                                    : 'bg-green-50 text-green-700'
                                }`}
                              >
                                {entry.type === 'Credit' ? (
                                  <ArrowUpRight size={19} />
                                ) : (
                                  <ArrowDownLeft size={19} />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-800">
                                  {entry.description}
                                </p>
                                <p className="text-xs text-slate-500">{entry.date}</p>
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <p
                                className={`text-sm font-bold ${
                                  entry.type === 'Credit' ? 'text-orange-700' : 'text-green-700'
                                }`}
                              >
                                {entry.type === 'Credit' ? '+' : '-'}
                                {money(entry.amount)}
                              </p>
                              <p className="text-xs text-slate-500">
                                Balance: {money(runningBalance)}
                              </p>
                            </div>
                          </div>
                        )
                      })}

                      {selectedLedgerEntries.length === 0 && (
                        <p className="p-8 text-center text-sm text-slate-500">
                          No new transactions yet. Add credit or record a payment to start this
                          customer's ledger.
                        </p>
                      )}

                      <div className="flex items-center justify-between bg-green-50 px-5 py-4">
                        <p className="text-sm font-bold text-green-900">Current balance</p>
                        <p className="text-lg font-bold text-green-900">
                          {money(selectedCustomer.balance)}
                        </p>
                      </div>
                    </div>
                ))()}
              </div>
            </section>
          )}

          {activePage === 'Ledger' && !selectedCustomer && (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
              <p className="text-slate-600">Customer not found.</p>
              <button
                onClick={() => handleNavigation('Customers')}
                className="mt-3 text-sm font-semibold text-green-700"
              >
                Return to customers
              </button>
            </div>
          )}

          {activePage === 'Transactions' && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 p-5">
                <h3 className="font-bold text-slate-900">Transaction history</h3>
                <p className="mt-1 text-xs text-slate-500">Credit and payment records</p>
              </div>
              <div className="divide-y divide-slate-100">
                {filteredTransactions.map((transaction) => (
                  <div
                    key={transaction.id}
                    className="flex items-center justify-between gap-4 p-5"
                  >
                    <div>
                      <p className="text-sm font-semibold">{transaction.customer}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {transaction.description} · {transaction.date}
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className={`text-sm font-bold ${
                          transaction.type === 'Credit' ? 'text-orange-700' : 'text-green-700'
                        }`}
                      >
                        {transaction.type === 'Credit' ? '+' : '-'}
                        {money(transaction.amount)}
                      </p>
                      <p className="text-xs text-slate-500">{transaction.type}</p>
                    </div>
                  </div>
                ))}
                {filteredTransactions.length === 0 && (
                  <p className="p-6 text-center text-sm text-slate-500">
                    No matching transactions found.
                  </p>
                )}
              </div>
            </section>
          )}

          {activePage === 'Products' && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex flex-col justify-between gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center">
                <div>
                  <h3 className="font-bold text-slate-900">Product catalogue</h3>
                  <p className="mt-1 text-xs text-slate-500">{products.length} products · Prices used for accurate transaction totals</p>
                </div>
                <button onClick={() => openProductForm()} className="flex items-center justify-center gap-2 rounded-xl bg-green-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-900">
                  <Plus size={17} /> Add product
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-4 font-semibold">Product</th>
                      <th className="px-5 py-4 font-semibold">Category</th>
                      <th className="px-5 py-4 font-semibold">Unit</th>
                      <th className="px-5 py-4 font-semibold">Price</th>
                      <th className="px-5 py-4 font-semibold">Stock</th>
                      <th className="px-5 py-4 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredProducts.map((product) => (
                      <tr key={product.id} className="hover:bg-green-50/40">
                        <td className="px-5 py-4 font-semibold text-slate-900">{product.name}</td>
                        <td className="px-5 py-4 text-slate-600">{product.category}</td>
                        <td className="px-5 py-4 text-slate-600">Per {product.unit}</td>
                        <td className="px-5 py-4 font-semibold">{money(product.price)}</td>
                        <td className="px-5 py-4">
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${product.stock <= 5 ? 'bg-red-50 text-red-700' : product.stock <= 15 ? 'bg-orange-50 text-orange-700' : 'bg-green-50 text-green-700'}`}>
                            {product.stock} {product.unit}{product.stock <= 5 ? ' · Low stock' : ''}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            <button title="Edit product" onClick={() => openProductForm(product)} className="rounded-lg p-2 text-slate-500 hover:bg-green-50 hover:text-green-800"><Edit2 size={17} /></button>
                            <button title="Delete product" onClick={() => deleteProduct(product.id)} className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-700"><X size={17} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredProducts.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-500">No products match your search. Add a new product to get started.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-slate-100 bg-green-50/60 px-5 py-3 text-xs text-slate-600">Tip: Keep product prices and stock updated. The voice assistant will use this catalogue when calculating credit entries.</div>
            </section>
          )}

          {activePage === 'Settings' && (
            <form onSubmit={saveSettings} className="space-y-6">
              <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
                <div className="mb-6"><h3 className="text-lg font-bold text-slate-900">Shop profile</h3><p className="mt-1 text-sm text-slate-500">Manage the details displayed in your KhataVoice workspace.</p></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {[['shopName','Shop name'],['ownerName','Owner name'],['phone','Phone number'],['address','Shop address']].map(([key,label])=><label key={key} className="block text-sm font-medium text-slate-700">{label}<input value={(shopSettings as any)[key]} onChange={e=>setShopSettings((v:any)=>({...v,[key]:e.target.value}))} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-green-600" placeholder={label}/></label>)}
                </div>
              </section>
              <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"><h3 className="text-lg font-bold text-slate-900">Preferences</h3><div className="mt-5 grid gap-5 sm:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">Preferred voice language<select value={shopSettings.language} onChange={e=>setShopSettings((v:any)=>({...v,language:e.target.value}))} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"><option>Hindi</option><option>Marathi</option><option>English</option><option>Hinglish</option><option>Auto detect</option></select></label>
                <label className="text-sm font-medium text-slate-700">Currency<select value={shopSettings.currency} onChange={e=>setShopSettings((v:any)=>({...v,currency:e.target.value}))} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"><option value="INR">Indian Rupee (₹)</option></select></label>
                <label className="text-sm font-medium text-slate-700">Low-stock alert threshold<input type="number" min="0" value={shopSettings.lowStock} onChange={e=>setShopSettings((v:any)=>({...v,lowStock:Number(e.target.value)}))} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"/></label>
              </div><div className="mt-6 space-y-4">{[['reminders','Enable payment reminders'],['sound','Enable notification sounds']].map(([key,label])=><label key={key} className="flex items-center justify-between rounded-xl bg-slate-50 p-4 text-sm text-slate-700">{label}<input type="checkbox" checked={Boolean((shopSettings as any)[key])} onChange={e=>setShopSettings((v:any)=>({...v,[key]:e.target.checked}))} className="h-4 w-4 accent-green-700"/></label>)}</div></section>
              <div className="flex items-center gap-3"><button type="submit" className="rounded-xl bg-green-800 px-6 py-3 text-sm font-semibold text-white hover:bg-green-900">Save settings</button>{settingsSaved && <span className="text-sm font-medium text-green-700">Settings saved on this device.</span>}</div>
            </form>
          )}

          <footer className="pb-4 text-center text-xs text-slate-400">
            KhataVoice AI · Your business, your language.
          </footer>
        </main>
      </div>

      {showAddCustomer && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={handleAddCustomer}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-slate-900">Add new customer</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Add someone to your digital khata.
                </p>
              </div>
              <button
                type="button"
                onClick={closeAddCustomer}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Close form"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="customerName"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  Customer name
                </label>
                <input
                  id="customerName"
                  value={newCustomerName}
                  onChange={(event) => setNewCustomerName(event.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  autoFocus
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                />
              </div>

              <div>
                <label
                  htmlFor="customerPhone"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  Phone number
                </label>
                <input
                  id="customerPhone"
                  type="tel"
                  inputMode="numeric"
                  value={newCustomerPhone}
                  onChange={(event) =>
                    setNewCustomerPhone(event.target.value.replace(/\D/g, '').slice(0, 10))
                  }
                  placeholder="10-digit mobile number"
                  maxLength={10}
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                />
              </div>

              {formError && (
                <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{formError}</p>
              )}
            </div>

            <div className="mt-7 flex gap-3">
              <button
                type="button"
                onClick={closeAddCustomer}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 rounded-xl bg-green-800 px-4 py-3 text-sm font-semibold text-white hover:bg-green-900"
              >
                Save customer
              </button>
            </div>
          </form>
        </div>
      )}

      {showProductForm && (
        <div className="fixed inset-0 z-[105] flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={handleSaveProduct} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-slate-900">{editingProductId !== null ? 'Edit product' : 'Add new product'}</h3>
                <p className="mt-1 text-sm text-slate-500">Maintain the prices used by your khata.</p>
              </div>
              <button type="button" onClick={closeProductForm} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close form"><X size={20} /></button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="productName" className="mb-2 block text-sm font-medium text-slate-700">Product name</label>
                <input id="productName" autoFocus value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="e.g. Basmati rice" className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100" />
              </div>
              <div>
                <label htmlFor="productCategory" className="mb-2 block text-sm font-medium text-slate-700">Category</label>
                <select id="productCategory" value={productCategory} onChange={(event) => setProductCategory(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-green-600">
                  {['Grains', 'Essentials', 'Dairy', 'Snacks', 'Beverages', 'Personal care', 'Other'].map((category) => <option key={category}>{category}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="productUnit" className="mb-2 block text-sm font-medium text-slate-700">Selling unit</label>
                <select id="productUnit" value={productUnit} onChange={(event) => setProductUnit(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-green-600">
                  {['kg', 'gram', 'litre', 'ml', 'piece', 'packet', 'dozen', 'box'].map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="productPrice" className="mb-2 block text-sm font-medium text-slate-700">Price (₹ per unit)</label>
                <input id="productPrice" type="number" min="0.01" step="0.01" value={productPrice} onChange={(event) => setProductPrice(event.target.value)} placeholder="e.g. 60" className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-green-600" />
              </div>
              <div>
                <label htmlFor="productStock" className="mb-2 block text-sm font-medium text-slate-700">Available stock</label>
                <input id="productStock" type="number" min="0" step="1" value={productStock} onChange={(event) => setProductStock(event.target.value)} placeholder="e.g. 25" className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-green-600" />
              </div>
            </div>
            {productError && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{productError}</p>}
            <div className="mt-7 flex gap-3">
              <button type="button" onClick={closeProductForm} disabled={isSavingProduct} className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={isSavingProduct} className="flex-1 rounded-xl bg-green-800 px-4 py-3 text-sm font-semibold text-white hover:bg-green-900 disabled:cursor-wait disabled:opacity-60">{isSavingProduct ? 'Saving to Supabase…' : editingProductId !== null ? 'Save changes' : 'Save product'}</button>
            </div>
          </form>
        </div>
      )}

      {showLedgerForm && selectedCustomer && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={handleLedgerTransaction}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-slate-900">
                  {ledgerType === 'Credit' ? 'Add credit' : 'Record payment'}
                </h3>
                <p className="mt-1 text-sm text-slate-500">{selectedCustomer.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowLedgerForm(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Close form"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Transaction type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setLedgerType('Credit')}
                    className={`rounded-xl border p-3 text-sm font-semibold ${
                      ledgerType === 'Credit'
                        ? 'border-orange-300 bg-orange-50 text-orange-800'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    Add credit
                  </button>
                  <button
                    type="button"
                    onClick={() => setLedgerType('Payment')}
                    className={`rounded-xl border p-3 text-sm font-semibold ${
                      ledgerType === 'Payment'
                        ? 'border-green-300 bg-green-50 text-green-800'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    Payment
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="ledgerAmount"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  Amount (₹)
                </label>
                <input
                  id="ledgerAmount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={ledgerAmount}
                  onChange={(event) => setLedgerAmount(event.target.value)}
                  placeholder="Enter amount"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                />
              </div>

              <div>
                <label
                  htmlFor="ledgerDescription"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  Description (optional)
                </label>
                <input
                  id="ledgerDescription"
                  value={ledgerDescription}
                  onChange={(event) => setLedgerDescription(event.target.value)}
                  placeholder={
                    ledgerType === 'Credit'
                      ? 'e.g. Rice, oil and groceries'
                      : 'e.g. Cash payment received'
                  }
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                />
              </div>

              {ledgerError && (
                <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{ledgerError}</p>
              )}
            </div>

            <div className="mt-7 flex gap-3">
              <button
                type="button"
                onClick={() => setShowLedgerForm(false)}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSavingTransaction}
                className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60 ${
                  ledgerType === 'Credit'
                    ? 'bg-orange-700 hover:bg-orange-800'
                    : 'bg-green-800 hover:bg-green-900'
                }`}
              >
                {isSavingTransaction ? 'Saving to Supabase…' : `Confirm ${ledgerType}`}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

type StatCardProps = {
  title: string
  value: string
  detail: string
  icon: ReactNode
  color: 'green' | 'blue' | 'orange' | 'purple'
}

function StatCard({ title, value, detail, icon, color }: StatCardProps) {
  const colors = {
    green: 'bg-green-50 text-green-800',
    blue: 'bg-blue-50 text-blue-800',
    orange: 'bg-orange-50 text-orange-800',
    purple: 'bg-purple-50 text-purple-800',
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${colors[color]}`}>
          {icon}
        </div>
      </div>
      <p className="mt-4 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  )
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const authClient = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [checking, setChecking] = useState(true)
  const [mode, setMode] = useState<'login'|'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!authClient) { setChecking(false); return }
    authClient.auth.getSession().then(({data})=>{setSession(data.session);setChecking(false)})
    const {data:{subscription}}=authClient.auth.onAuthStateChange((_event,next)=>setSession(next))
    return ()=>subscription.unsubscribe()
  }, [])
  const submitAuth = async (event: FormEvent) => {
    event.preventDefault(); if(!authClient)return; setBusy(true);setAuthError('')
    const result = mode==='signup' ? await authClient.auth.signUp({email,password}) : await authClient.auth.signInWithPassword({email,password})
    setBusy(false)
    if(result.error){setAuthError(result.error.message);return}
    if(mode==='signup' && !result.data.session) setAuthError('Account created. Check your email to confirm your address, then log in.')
  }
  const signOut = async () => { if(authClient) await authClient.auth.signOut() }
  if(checking) return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading your secure workspace…</div>
  if(!authClient) return <div className="flex min-h-screen items-center justify-center bg-[#f6f8f5] p-5"><div className="max-w-lg rounded-2xl bg-white p-8 shadow-sm"><h1 className="text-2xl font-bold text-green-900">KhataVoice AI setup required</h1><p className="mt-3 text-sm leading-6 text-slate-600">Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to the frontend environment, then restart the development server. Never put the Supabase service-role key in the frontend.</p></div></div>
  if(!session) return <div className="flex min-h-screen items-center justify-center bg-[#f6f8f5] p-5"><form onSubmit={submitAuth} className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"><div className="mb-7"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-800 text-white"><ShoppingBag/></div><h1 className="mt-5 text-2xl font-bold text-green-950">KhataVoice AI</h1><p className="mt-1 text-sm text-slate-500">{mode==='login'?'Welcome back. Sign in to your shop.':'Create your shopkeeper account.'}</p></div><label className="block text-sm font-medium text-slate-700">Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" placeholder="you@example.com"/></label><label className="mt-4 block text-sm font-medium text-slate-700">Password<input type="password" required minLength={6} value={password} onChange={e=>setPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" placeholder="At least 6 characters"/></label>{authError&&<p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{authError}</p>}<button disabled={busy} className="mt-6 w-full rounded-xl bg-green-800 py-3 font-semibold text-white disabled:opacity-60">{busy?'Please wait…':mode==='login'?'Sign in':'Create account'}</button><p className="mt-5 text-center text-sm text-slate-500">{mode==='login'?"New to KhataVoice?":"Already registered?"} <button type="button" onClick={()=>{setMode(mode==='login'?'signup':'login');setAuthError('')}} className="font-semibold text-green-800">{mode==='login'?'Create an account':'Sign in'}</button></p></form></div>
  return <DashboardApp onSignOut={signOut} userEmail={session.user.email || ''}/>
}

export default App
