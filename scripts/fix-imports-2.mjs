import fs from 'fs';

function edit(p, from, to) {
  const s = fs.readFileSync(p, 'utf8');
  if (!s.includes(from)) { console.log('MISS', p, JSON.stringify(from).slice(0, 60)); return; }
  fs.writeFileSync(p, s.split(from).join(to));
  console.log('OK', p, JSON.stringify(from).slice(0, 50));
}

// AttendanceReportPage: strip Select
edit('src/modules/reports/AttendanceReportPage.tsx',
  "import { PageHeader, Card, Select, Input } from '@/core/ui/components';",
  "import { PageHeader, Card, Button, Input } from '@/core/ui/components';");

// DocInvoiceDetailsPage: restore User/TrendingUp (used), remove Coins (unused)
edit('src/modules/reports/DocInvoiceDetailsPage.tsx',
  "import { Package, CreditCard } from 'lucide-react';",
  "import { Package, User, TrendingUp, CreditCard } from 'lucide-react';");
edit('src/modules/reports/DocInvoiceDetailsPage.tsx',
  "import { PageHeader, Card, Button, Select } from '@/core/ui/components';",
  "import { PageHeader, Card, Button, Select, Input } from '@/core/ui/components';");

// EndOfServiceReportPage
edit('src/modules/reports/EndOfServiceReportPage.tsx',
  "import { TrendingUp, Coins, Users } from 'lucide-react';",
  "import { TrendingUp, Coins, User } from 'lucide-react';");

// FixedAssetsDepreciationReportPage
edit('src/modules/reports/FixedAssetsDepreciationReportPage.tsx',
  "import { TrendingUp, Coins, Package } from 'lucide-react';",
  "import { TrendingUp, Coins, Package } from 'lucide-react';");

// InventoryItemLedgerPage
edit('src/modules/reports/InventoryItemLedgerPage.tsx',
  "import { Package, , TrendingUp, TrendingDown } from 'lucide-react';",
  "import { Package, TrendingUp, TrendingDown } from 'lucide-react';");
edit('src/modules/reports/InventoryItemLedgerPage.tsx',
  "import { PageHeader, Card, Input, Select } from '@/core/ui/components';",
  "import { PageHeader, Card, Button, Input, Select } from '@/core/ui/components';");

// ManufacturingVariancePage — all imports unused fix
edit('src/modules/reports/ManufacturingVariancePage.tsx',
  "import { TrendingUp, TrendingDown, Package, AlertTriangle } from 'lucide-react';\nimport { PageHeader, Card, Select } from '@/core/ui/components';",
  "import { TrendingUp, TrendingDown, Package } from 'lucide-react';\nimport { PageHeader, Card, Button, Select } from '@/core/ui/components';");
edit('src/modules/reports/ManufacturingVariancePage.tsx',
  "  const { formatCurrency } = useFormatters();\n",
  "");

// PayrollReportPage — Bank → Landmark, remove unused
edit('src/modules/reports/PayrollReportPage.tsx',
  "import { User, DollarSign, Bank, TrendingUp, AlertTriangle, Play } from 'lucide-react';",
  "import { User, DollarSign, Landmark, AlertTriangle } from 'lucide-react';");

// RepPerformancePage — remove unused
edit('src/modules/reports/RepPerformancePage.tsx',
  "import { TrendingUp, Users, DollarSign, Users as UserIcon } from 'lucide-react';",
  "import { TrendingUp, DollarSign, UserIcon } from 'lucide-react';");
edit('src/modules/reports/RepPerformancePage.tsx',
  "import { PageHeader, Card, Select, Input } from '@/core/ui/components';",
  "import { PageHeader, Card, Select } from '@/core/ui/components';");
edit('src/modules/reports/RepPerformancePage.tsx',
  "import { sumCol, percentOf, deltaWithPct } from './shared/liveAggregates';",
  "import { sumCol } from './shared/liveAggregates';");

// SalesCommissionReportPage — remove unused
edit('src/modules/reports/SalesCommissionReportPage.tsx',
  "import { DollarSign, TrendingUp, User, Users } from 'lucide-react';",
  "import { DollarSign, User } from 'lucide-react';");
edit('src/modules/reports/SalesCommissionReportPage.tsx',
  "import { PageHeader, Card, Input, Select } from '@/core/ui/components';",
  "import { PageHeader, Card, Input } from '@/core/ui/components';");
edit('src/modules/reports/SalesCommissionReportPage.tsx',
  "import { sumCol, deltaWithPct } from './shared/liveAggregates';",
  "import { sumCol } from './shared/liveAggregates';");

// ProductionCostReportPage — remove unused
edit('src/modules/reports/ProductionCostReportPage.tsx',
  "import { Package, Warehouse, TrendingUp, Coins } from 'lucide-react';",
  "import { Package, Warehouse, Coins } from 'lucide-react';");
edit('src/modules/reports/ProductionCostReportPage.tsx',
  "import { PageHeader, Card, Select, Input } from '@/core/ui/components';",
  "import { PageHeader, Card, Button, Input } from '@/core/ui/components';");
edit('src/modules/reports/ProductionCostReportPage.tsx',
  "import { sumCol, deltaWithPct } from './shared/liveAggregates';",
  "import { sumCol } from './shared/liveAggregates';");

// StockDiffReportPage
edit('src/modules/reports/StockDiffReportPage.tsx',
  "import { Package, Warehouse, TrendingUp, TrendingDown } from 'lucide-react';",
  "import { Package, Warehouse, TrendingUp, TrendingDown } from 'lucide-react';");
console.log('done');
