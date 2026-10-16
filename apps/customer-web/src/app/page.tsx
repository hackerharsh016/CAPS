export default function CustomerHomePage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Hero Section */}
      <div className="rounded-2xl bg-gradient-to-r from-blue-700 to-indigo-800 p-8 text-white shadow-lg">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          Zero-Queue Printing with CAPS
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-blue-100">
          Upload your files, set exact paper, color, duplex, and binding preferences, pay online,
          and pick up when your order is ready.
        </p>
        <div className="mt-6 flex flex-wrap gap-4">
          <button className="rounded-lg bg-white px-5 py-3 text-sm font-semibold text-blue-700 shadow-sm hover:bg-blue-50">
            Start New Print Order
          </button>
          <button className="rounded-lg border border-blue-300 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800/40">
            Track Existing Job
          </button>
        </div>
      </div>

      {/* Feature Pillars */}
      <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 font-bold">
            1
          </div>
          <h2 className="mt-4 text-base font-semibold text-slate-900">Configure Exactly</h2>
          <p className="mt-2 text-sm text-slate-600">
            Select A4/A3, Color or B/W, Duplex, Custom Page Ranges, and Spiral Binding upfront with
            instant live pricing.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 font-bold">
            2
          </div>
          <h2 className="mt-4 text-base font-semibold text-slate-900">Two-Tier Queue</h2>
          <p className="mt-2 text-sm text-slate-600">
            Choose Flexible FIFO or Urgent priority jump. Follow live token position and completion
            ETAs in real time.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 font-bold">
            3
          </div>
          <h2 className="mt-4 text-base font-semibold text-slate-900">Privacy Guaranteed</h2>
          <p className="mt-2 text-sm text-slate-600">
            Encrypted storage and automatic document destruction immediately after physical print
            completion.
          </p>
        </div>
      </div>
    </div>
  );
}
