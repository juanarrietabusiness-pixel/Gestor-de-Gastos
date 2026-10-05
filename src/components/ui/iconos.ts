/**
 * Registro explicito de iconos.
 *
 * Antes esto era `import * as Icons from 'lucide-react'` con busqueda dinamica
 * por nombre. Comodo de escribir, pero le impide al empaquetador saber cuales
 * se usan: terminaba incluyendo las ~1.500 del paquete y el bundle principal
 * pesaba 1,16 MB.
 *
 * Con el registro explicito solo entran estos. Agregar uno nuevo es sumar una
 * linea en GRUPOS_ICONO y otra en el import; si alguien usa un nombre que no
 * esta, cae en el generico en vez de romper la pantalla.
 */

import {
  Activity, Apple, Archive, ArrowDownLeft, ArrowLeft, ArrowLeftRight,
  ArrowUp, ArrowUpRight, Baby, Backpack, Banknote, Bed, Beer, Bell, Bike, Book,
  BookOpen, Brain, Briefcase, Building2, Bus, Cake, Calculator, Calendar,
  CalendarDays, Camera, Car, CarTaxiFront, Carrot, Cat, ChartColumn,
  ChartLine, ChartPie, Check, ChevronDown, ChevronLeft, ChevronRight,
  ChevronUp, Church, Cigarette, Circle, CircleCheck, CircleEllipsis,
  CircleHelp, CirclePlus, Clapperboard, CloudOff, Coffee, Coins, CreditCard,
  Crown, Delete, Dices, Dog, Download, Drill, Droplet, Dumbbell, Egg, Eye, FileMinus,
  Filter, Fish, Flame, Flower2, Footprints, Fuel, Gamepad2, Gem, Gift,
  Glasses, GraduationCap, GripVertical, Guitar, Hammer, HandCoins, HandHeart,
  Handshake, Headphones, Heart, HeartHandshake, HeartPulse, House,
  IceCreamCone, Key, Lamp, Landmark, Laptop, Leaf, Library, Lightbulb,
  LoaderCircle, Lock, Square,
  LogOut, Luggage, Mail, MapPin, Mic, Milk, Minus, Mountain, Music, Newspaper,
  NotebookPen, Package, PaintRoller, Palette, Palmtree, ParkingMeter,
  PartyPopper, PawPrint, Pencil, Percent, Phone, PiggyBank, Pill, Pizza,
  Plane, PlaneLanding, PlaneTakeoff, Plug, Plus, Popcorn, Printer,
  ReceiptText, Recycle, Repeat, Router, Sandwich, Scale, School, Scissors,
  SearchX, Settings, Settings2, Shield, Ship, Shirt, ShoppingBag,
  ShoppingBasket, ShoppingCart, Smartphone, Smile, Snowflake, Sofa, Soup,
  Sparkles, Split, Sprout, Stethoscope, Store, Sun, Syringe, Tag, Tags, Tent,
  Thermometer, Ticket, ToyBrick, TrainFront, Trash, Trash2, Trees,
  TrendingDown, TrendingUp, TriangleAlert, Tv, Umbrella, UserPlus, UserRound,
  Users, Utensils, Volleyball, Wallet, WandSparkles, Watch, Waves, Wifi,
  Wine, Wrench, X, Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Los que se pueden elegir para una categoria, agrupados por tema.
 *
 * Van agrupados y no en una lista suelta porque con 148 iconos,
 * encontrar el del veterinario entre flechas y engranajes es un trabajo. El
 * selector muestra estos titulos, asi que quien busca "algo de comida" mira un
 * solo renglon en vez de recorrer toda la grilla.
 *
 * Los de la interfaz (flechas, cruces, el tacho de basura) quedan afuera a
 * proposito: antes aparecian en el selector y no representan ningun gasto.
 */
export const GRUPOS_ICONO: { grupo: string; iconos: string[] }[] = [
  {
    grupo: 'Comida',
    iconos: [
    'utensils', 'coffee', 'pizza', 'sandwich', 'soup', 'fish', 'egg',
    'carrot', 'apple', 'milk', 'cake', 'ice-cream-cone', 'beer', 'wine'
    ],
  },
  {
    grupo: 'Compras',
    iconos: [
    'shopping-cart', 'shopping-bag', 'shopping-basket', 'store', 'package',
    'tag', 'gift', 'shirt', 'footprints', 'watch', 'glasses', 'gem',
    'crown', 'scissors'
    ],
  },
  {
    grupo: 'Transporte',
    iconos: [
    'car', 'fuel', 'bus', 'train-front', 'bike', 'car-taxi-front',
    'parking-meter', 'ship', 'map-pin'
    ],
  },
  {
    grupo: 'Casa',
    iconos: [
    'house', 'key', 'bed', 'sofa', 'lamp', 'hammer', 'wrench', 'drill',
    'paint-roller', 'trees', 'flower-2', 'leaf', 'sprout', 'recycle'
    ],
  },
  {
    grupo: 'Servicios',
    iconos: [
    'zap', 'droplet', 'flame', 'lightbulb', 'plug', 'thermometer', 'wifi',
    'router', 'phone', 'smartphone', 'tv', 'printer'
    ],
  },
  {
    grupo: 'Salud',
    iconos: [
    'heart-pulse', 'pill', 'stethoscope', 'syringe', 'dumbbell', 'brain',
    'activity', 'shield'
    ],
  },
  {
    grupo: 'Educacion',
    iconos: [
    'graduation-cap', 'book', 'book-open', 'library', 'school', 'pencil',
    'notebook-pen', 'backpack'
    ],
  },
  {
    grupo: 'Ocio',
    iconos: [
    'popcorn', 'clapperboard', 'music', 'headphones', 'guitar', 'mic',
    'gamepad-2', 'dices', 'ticket', 'party-popper', 'palette', 'camera',
    'volleyball', 'tent', 'sparkles'
    ],
  },
  {
    grupo: 'Viajes',
    iconos: [
    'plane', 'plane-takeoff', 'plane-landing', 'luggage', 'umbrella',
    'sun', 'snowflake', 'waves', 'mountain', 'palmtree'
    ],
  },
  {
    grupo: 'Familia',
    iconos: [
    'baby', 'toy-brick', 'paw-print', 'dog', 'cat', 'users', 'user-round',
    'smile', 'heart', 'hand-heart', 'heart-handshake', 'church'
    ],
  },
  {
    grupo: 'Trabajo y dinero',
    iconos: [
    'briefcase', 'laptop', 'building-2', 'handshake', 'banknote', 'coins',
    'hand-coins', 'wallet', 'credit-card', 'piggy-bank', 'landmark',
    'receipt-text', 'calculator', 'percent', 'scale', 'trending-up',
    'trending-down', 'chart-line', 'chart-pie'
    ],
  },
  {
    grupo: 'Otros',
    iconos: [
    'newspaper', 'mail', 'archive', 'file-minus', 'split', 'repeat',
    'calendar', 'tags', 'bell', 'cigarette', 'circle-plus',
    'circle-ellipsis', 'circle'
    ],
  },
];

/** Todos los elegibles, en el orden en que se muestran. */
export const ICONOS_CATEGORIA: string[] = GRUPOS_ICONO.flatMap((g) => g.iconos);

/** Registro completo: los de categoria mas los que usa la propia interfaz. */
export const ICONOS: Record<string, LucideIcon> = {
  'activity': Activity,
  'apple': Apple,
  'archive': Archive,
  'arrow-down-left': ArrowDownLeft,
  'arrow-left': ArrowLeft,
  'arrow-left-right': ArrowLeftRight,
  // El de mandar un mensaje en el consejero, y el que gira mientras responde.
  // Los dos se estaban pidiendo por nombre sin estar registrados, asi que el
  // boton dibujaba el generico —un circulo vacio— en vez de una flecha.
  'arrow-up': ArrowUp,
  'arrow-up-right': ArrowUpRight,
  'baby': Baby,
  'backpack': Backpack,
  'banknote': Banknote,
  'bed': Bed,
  'beer': Beer,
  'bell': Bell,
  'bike': Bike,
  'book': Book,
  'book-open': BookOpen,
  'brain': Brain,
  'briefcase': Briefcase,
  'building-2': Building2,
  'bus': Bus,
  'cake': Cake,
  'calculator': Calculator,
  'calendar': Calendar,
  'calendar-days': CalendarDays,
  'camera': Camera,
  'car': Car,
  'car-taxi-front': CarTaxiFront,
  'carrot': Carrot,
  'cat': Cat,
  'chart-column': ChartColumn,
  'chart-line': ChartLine,
  'chart-pie': ChartPie,
  'check': Check,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'church': Church,
  'cigarette': Cigarette,
  'circle': Circle,
  'circle-check': CircleCheck,
  'circle-ellipsis': CircleEllipsis,
  'circle-help': CircleHelp,
  'circle-plus': CirclePlus,
  'clapperboard': Clapperboard,
  'cloud-off': CloudOff,
  'coffee': Coffee,
  'coins': Coins,
  'credit-card': CreditCard,
  'crown': Crown,
  'dices': Dices,
  'dog': Dog,
  'download': Download,
  'drill': Drill,
  'droplet': Droplet,
  'dumbbell': Dumbbell,
  'egg': Egg,
  'eye': Eye,
  'file-minus': FileMinus,
  'filter': Filter,
  'fish': Fish,
  'flame': Flame,
  'flower-2': Flower2,
  'footprints': Footprints,
  'fuel': Fuel,
  'gamepad-2': Gamepad2,
  'gem': Gem,
  'gift': Gift,
  'glasses': Glasses,
  'graduation-cap': GraduationCap,
  'grip-vertical': GripVertical,
  'guitar': Guitar,
  'hammer': Hammer,
  'hand-coins': HandCoins,
  'hand-heart': HandHeart,
  'handshake': Handshake,
  'headphones': Headphones,
  'heart': Heart,
  'heart-handshake': HeartHandshake,
  'heart-pulse': HeartPulse,
  'house': House,
  'ice-cream-cone': IceCreamCone,
  'key': Key,
  'lamp': Lamp,
  'landmark': Landmark,
  'laptop': Laptop,
  'leaf': Leaf,
  'library': Library,
  'lightbulb': Lightbulb,
  'loader-circle': LoaderCircle,
  'lock': Lock,
  'log-out': LogOut,
  'luggage': Luggage,
  'mail': Mail,
  'map-pin': MapPin,
  'mic': Mic,
  'milk': Milk,
  'mountain': Mountain,
  'music': Music,
  'newspaper': Newspaper,
  'notebook-pen': NotebookPen,
  'package': Package,
  'paint-roller': PaintRoller,
  'palette': Palette,
  'palmtree': Palmtree,
  'parking-meter': ParkingMeter,
  'party-popper': PartyPopper,
  'paw-print': PawPrint,
  'pencil': Pencil,
  'percent': Percent,
  'phone': Phone,
  'piggy-bank': PiggyBank,
  'pill': Pill,
  'pizza': Pizza,
  'plane': Plane,
  'plane-landing': PlaneLanding,
  'plane-takeoff': PlaneTakeoff,
  'plug': Plug,
  'plus': Plus,
  'popcorn': Popcorn,
  'printer': Printer,
  'receipt-text': ReceiptText,
  'recycle': Recycle,
  'repeat': Repeat,
  'router': Router,
  'sandwich': Sandwich,
  'scale': Scale,
  'school': School,
  'scissors': Scissors,
  'search-x': SearchX,
  'settings': Settings,
  'settings-2': Settings2,
  'shield': Shield,
  'ship': Ship,
  'shirt': Shirt,
  'shopping-bag': ShoppingBag,
  'shopping-basket': ShoppingBasket,
  'shopping-cart': ShoppingCart,
  'smartphone': Smartphone,
  'smile': Smile,
  'snowflake': Snowflake,
  'sofa': Sofa,
  'soup': Soup,
  'square': Square,
  'sparkles': Sparkles,
  'split': Split,
  'sprout': Sprout,
  'stethoscope': Stethoscope,
  'store': Store,
  'sun': Sun,
  'syringe': Syringe,
  'tag': Tag,
  'tags': Tags,
  'tent': Tent,
  'thermometer': Thermometer,
  'ticket': Ticket,
  'toy-brick': ToyBrick,
  'train-front': TrainFront,
  'trash': Trash,
  'minus': Minus,
  'trash-2': Trash2,
  /* El borrar del teclado de monto: la tecla con la flecha, no un tacho. */
  'delete': Delete,
  'trees': Trees,
  'trending-down': TrendingDown,
  'trending-up': TrendingUp,
  'triangle-alert': TriangleAlert,
  'tv': Tv,
  'umbrella': Umbrella,
  'user-plus': UserPlus,
  'user-round': UserRound,
  'users': Users,
  'utensils': Utensils,
  'volleyball': Volleyball,
  'wallet': Wallet,
  'wand-sparkles': WandSparkles,
  'watch': Watch,
  'waves': Waves,
  'wifi': Wifi,
  'wine': Wine,
  'wrench': Wrench,
  'x': X,
  'zap': Zap,
};

/** Se usa cuando el nombre guardado no esta en el registro. */
export const ICONO_GENERICO = Circle;
