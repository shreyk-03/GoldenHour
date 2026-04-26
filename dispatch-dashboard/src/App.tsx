import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Activity, Clock, MapPin, Navigation, ShieldAlert, CheckCircle2, Zap, MousePointerClick, HeartPulse, Car, UserCheck, Plus, Minus, AlertTriangle, Layers, LocateFixed, Eye, EyeOff, Settings } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { motion, AnimatePresence } from 'motion/react';


delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});



// Custom icons are now handled via L.divIcon in the render function


type Hospital = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  level: number;
  icuAvailable: number;
  icuTotal: number;
  ventsAvailable: number;
  ventsTotal: number;
  hasNeuro: boolean;
  hasCathLab: boolean;
  load: number; // 0-100%
};

type Patient = {
  id: string;
  lat: number;
  lng: number;
  vitals: { hr: number; bp: string; spo2: number; gcs: number };
  symptoms: string;
  predictedNeeds: string[];
  severity: 'Critical' | 'Urgent' | 'Stable';
  assignedHospitalId: string | null;
  routingRationale: string | null;
  eta: number | null; // minutes
};


const INITIAL_HOSPITALS: Hospital[] = [
  { id: 'h1', name: 'General Hospital', lat: 40.7128, lng: -74.0060, level: 1, icuAvailable: 5, icuTotal: 20, ventsAvailable: 10, ventsTotal: 50, hasNeuro: true, hasCathLab: true, load: 75 },
  { id: 'h2', name: 'City Medical Center', lat: 40.7580, lng: -73.9855, level: 2, icuAvailable: 1, icuTotal: 20, ventsAvailable: 2, ventsTotal: 30, hasNeuro: false, hasCathLab: true, load: 95 },
  { id: 'h3', name: 'Regional Health', lat: 40.6782, lng: -73.9442, level: 3, icuAvailable: 8, icuTotal: 10, ventsAvailable: 5, ventsTotal: 15, hasNeuro: false, hasCathLab: false, load: 40 },
  { id: 'h4', name: 'University Hospital', lat: 40.8075, lng: -73.9626, level: 1, icuAvailable: 12, icuTotal: 50, ventsAvailable: 45, ventsTotal: 100, hasNeuro: true, hasCathLab: true, load: 60 },
];

const INITIAL_PATIENTS: Patient[] = [
  {
    id: 'p1',
    lat: 40.7306,
    lng: -73.9866,
    vitals: { hr: 130, bp: '90/60', spo2: 88, gcs: 8 },
    symptoms: 'Severe head trauma, unresponsive',
    predictedNeeds: ['ICU', 'Ventilator', 'Neurosurgeon'],
    severity: 'Critical',
    assignedHospitalId: 'h4',
    routingRationale: 'General Hospital is closer but ICU is nearing capacity (75% load). University Hospital has ample ICU beds (12 avail), Ventilators, and on-duty Neurosurgeon. ETA: 12 mins.',
    eta: 12,
  }
];


function MapEvents({ onLocationSelect }: { onLocationSelect: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onLocationSelect(e.latlng.lat, e.latlng.lng);
    }
  });
  return null;
}

function MapController({ center, zoom }: { center: [number, number] | null, zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, zoom || 13, { animate: true, duration: 1.5 });
    }
  }, [center, map, zoom]);
  return null;
}

const API_URL = import.meta.env.VITE_API_URL || (window.location.origin === 'http://localhost:5174' ? 'http://localhost:3000/api' : '/api');
const WS_URL = import.meta.env.VITE_WS_URL || (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + (window.location.origin === 'http://localhost:5174' ? 'localhost:3000' : window.location.host) + '/ws';

function MapControls({ onRecenter, showGrid, setShowGrid, showRoutes, setShowRoutes }: { 
  onRecenter: () => void, 
  showGrid: boolean, 
  setShowGrid: (v: boolean) => void,
  showRoutes: boolean,
  setShowRoutes: (v: boolean) => void
}) {
  const map = useMap();
  return (
    <div className="custom-zoom-controls">
      <div className="control-group bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-2xl p-1.5 shadow-2xl flex flex-col gap-1">
        <button onClick={() => map.zoomIn()} className="zoom-btn" title="Zoom In">
          <Plus className="h-4 w-4" />
        </button>
        <button onClick={() => map.zoomOut()} className="zoom-btn" title="Zoom Out">
          <Minus className="h-4 w-4" />
        </button>
      </div>

      <div className="control-group bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-2xl p-1.5 shadow-2xl flex flex-col gap-1">
        <button onClick={onRecenter} className="zoom-btn" title="Recenter Map">
          <LocateFixed className="h-4 w-4 text-blue-400" />
        </button>
        <button onClick={() => setShowRoutes(!showRoutes)} className="zoom-btn" title="Toggle Routes">
          {showRoutes ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-gray-500" />}
        </button>
        <button onClick={() => setShowGrid(!showGrid)} className="zoom-btn" title="Toggle Grid">
          <Layers className={`h-4 w-4 ${showGrid ? 'text-emerald-400' : 'text-gray-500'}`} />
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isMassCasualty, setIsMassCasualty] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  
  // UI Toggles
  const [showGrid, setShowGrid] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [isLiveMode, setIsLiveMode] = useState(true);

  // Fetch Hospitals and Patients
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [hResp, pResp] = await Promise.all([
          fetch(`${API_URL}/hospitals`),
          fetch(`${API_URL}/patients`)
        ]);
        const hData = await hResp.json();
        const pData = await pResp.json();

        if (hData.success) {
          const mappedHospitals: Hospital[] = hData.data.map((h: any) => ({
            id: h.id,
            name: h.name,
            lat: h.latitude,
            lng: h.longitude,
            level: h.trauma_level,
            icuAvailable: h.icu_beds_available,
            icuTotal: h.icu_beds_total,
            ventsAvailable: h.ventilators_available,
            ventsTotal: h.ventilators_total,
            hasNeuro: h.specialists?.some((s: any) => s.specialty === 'neurosurgeon'),
            hasCathLab: h.has_cath_lab,
            load: h.current_load_percent
          }));
          setHospitals(mappedHospitals);
        }

        if (pData.success) {
          const mappedPatients: Patient[] = pData.data.map((p: any) => ({
            id: p._id || p.id,
            lat: p.latest_dispatch?.latitude || 18.5204,
            lng: p.latest_dispatch?.longitude || 73.8567,
            vitals: {
              hr: p.vitals?.heart_rate || 80,
              bp: p.vitals ? `${p.vitals.systolic_bp}/${p.vitals.diastolic_bp || 80}` : '120/80',
              spo2: p.vitals?.spo2 || 98,
              gcs: p.vitals?.gcs_score || 15
            },
            symptoms: Array.isArray(p.symptoms) ? p.symptoms.join(', ') : (p.symptoms || ''),
            predictedNeeds: p.predicted_care_needs || [],
            severity: p.severity_level ? (p.severity_level.charAt(0).toUpperCase() + p.severity_level.slice(1)) : 'Stable',
            assignedHospitalId: p.assigned_hospital_id,
            routingRationale: p.routing_rationale,
            eta: p.estimated_transit_minutes
          }));
          setPatients(mappedPatients);
          if (mappedPatients.length > 0 && !selectedPatientId) setSelectedPatientId(mappedPatients[0].id);
        }
      } catch (err) {
        console.error('Error fetching data:', err);
      }
    };

    fetchData();

    // WebSocket for real-time updates
    const ws = new WebSocket(WS_URL);
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'HOSPITAL_CAPACITY_UPDATED') {
        setHospitals(prev => prev.map(h => 
          h.id === message.hospitalId 
            ? { ...h, icuAvailable: message.snapshot.icu_beds_available, ventsAvailable: message.snapshot.ventilators_available, load: message.snapshot.current_load_percent }
            : h
        ));
      } else if (message.type === 'NEW_DISPATCH') {
        fetchData(); // Refresh all for simplicity
      }
    };

    return () => ws.close();
  }, []);

  // Form State
  const [newPatient, setNewPatient] = useState({
    hr: 80, bp: '120/80', spo2: 98, gcs: 15, symptoms: '', lat: 18.5204, lng: 73.8567
  });


  const performDispatch = async (patientData: typeof newPatient) => {
    try {
      // Parse BP string "120/80"
      const bpParts = patientData.bp.split('/');
      const systolic = parseInt(bpParts[0]) || 120;
      const diastolic = parseInt(bpParts[1]) || 80;

      const body = {
        heart_rate: patientData.hr,
        systolic_bp: systolic,
        diastolic_bp: diastolic,
        respiratory_rate: 18, 
        spo2: patientData.spo2,
        gcs_score: patientData.gcs,
        symptoms: patientData.symptoms ? [patientData.symptoms] : [], 
        incident_latitude: patientData.lat,
        incident_longitude: patientData.lng
      };

      const response = await fetch(`${API_URL}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const result = await response.json();
      if (result.success) {
        const dispatchData = result.data;
        
        const newPatientRecord: Patient = {
          id: dispatchData.patientId,
          lat: patientData.lat,
          lng: patientData.lng,
          vitals: { 
            hr: body.heart_rate, 
            bp: `${systolic}/${diastolic}`,
            spo2: body.spo2,
            gcs: body.gcs_score
          },
          symptoms: patientData.symptoms,
          predictedNeeds: dispatchData.prediction?.predictedCareNeeds ? 
            Object.keys(dispatchData.prediction.predictedCareNeeds).filter(k => dispatchData.prediction.predictedCareNeeds[k]) : [],
          severity: dispatchData.prediction?.severityLevel ? 
            (dispatchData.prediction.severityLevel.charAt(0).toUpperCase() + dispatchData.prediction.severityLevel.slice(1)) : 'Stable',
          assignedHospitalId: dispatchData.routing?.optimal?.hospital?.id,
          routingRationale: dispatchData.rationale || 'Optimal route calculated based on live regional capacity.',
          eta: dispatchData.routing?.optimal?.transitMinutes || 10
        };

        setPatients(prev => [newPatientRecord, ...prev]);
        setSelectedPatientId(newPatientRecord.id);
        setMapCenter([newPatientRecord.lat, newPatientRecord.lng]);
        
        // Refresh hospitals to get updated load
        const hResp = await fetch(`${API_URL}/hospitals`);
        const hData = await hResp.json();
        if (hData.success) {
          const mappedHospitals: Hospital[] = hData.data.map((h: any) => ({
            id: h.id,
            name: h.name,
            lat: h.latitude,
            lng: h.longitude,
            level: h.trauma_level,
            icuAvailable: h.icu_beds_available,
            icuTotal: h.icu_beds_total,
            ventsAvailable: h.ventilators_available,
            ventsTotal: h.ventilators_total,
            hasNeuro: h.has_stroke_center || h.specialists?.some((s: any) => s.specialty === 'neurosurgeon'),
            hasCathLab: h.has_cath_lab,
            load: h.current_load_percent
          }));
          setHospitals(mappedHospitals);
        }
      } else {
        console.error('Dispatch failed:', result.error);
      }
    } catch (err) {
      console.error('Dispatch error:', err);
    }
    setNewPatient(prev => ({ ...prev, symptoms: '' }));
  };


  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const emergencyType = params.get('emergency');

    if (emergencyType) {
      let scenarioData = null;
      if (emergencyType === 'cardiac') {
        scenarioData = { hr: 145, bp: '90/60', spo2: 92, gcs: 14, symptoms: 'CRITICAL CARDIAC: Severe chest pain, diaphoresis, suspected STEMI' };
      } else if (emergencyType === 'head') {
        scenarioData = { hr: 130, bp: '80/50', spo2: 88, gcs: 7, symptoms: 'CRITICAL TRAUMA: Multi-system trauma, MVA, unresponsive' };
      } else if (emergencyType === 'bleeding') {
        scenarioData = { hr: 110, bp: '100/70', spo2: 94, gcs: 15, symptoms: 'URGENT BLEEDING: Heavy arterial bleeding, shock, deep laceration' };
      } else if (emergencyType === 'unconscious') {
        scenarioData = { hr: 50, bp: '80/40', spo2: 85, gcs: 5, symptoms: 'CRITICAL NEURO: Unconscious person, shallow breathing' };
      } else if (emergencyType === 'burns') {
        scenarioData = { hr: 120, bp: '130/90', spo2: 98, gcs: 15, symptoms: 'URGENT BURNS: Severe 3rd degree burns, chemical exposure' };
      }

      if (scenarioData) {
        const fullPatientData = { ...newPatient, ...scenarioData };
        setNewPatient(fullPatientData);

        setTimeout(() => performDispatch(fullPatientData), 1000);
      }
    }
  }, []);

  const selectedPatient = patients.find(p => p.id === selectedPatientId);

  // Quick Scenarios for "Daily Use"
  const fillScenario = (type: 'cardiac' | 'trauma' | 'stable') => {
    if (type === 'cardiac') setNewPatient({ ...newPatient, hr: 145, bp: '90/60', spo2: 92, gcs: 14, symptoms: 'Severe chest pain, diaphoresis, suspected STEMI' });
    if (type === 'trauma') setNewPatient({ ...newPatient, hr: 130, bp: '80/50', spo2: 88, gcs: 7, symptoms: 'Multi-system trauma, MVA, unresponsive' });
    if (type === 'stable') setNewPatient({ ...newPatient, hr: 80, bp: '120/80', spo2: 99, gcs: 15, symptoms: 'Minor laceration to arm, bleeding controlled' });
  };

  const handleLocationSelect = (lat: number, lng: number) => {
    setNewPatient(prev => ({ ...prev, lat, lng }));
  };

  const handlePatientSelect = (patient: Patient) => {
    setSelectedPatientId(patient.id);
    setMapCenter([patient.lat, patient.lng]);
  };

  const handleTriageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    performDispatch(newPatient);
  };

  return (
    <div className="flex flex-col h-screen bg-[#0B0F1A] text-gray-100 font-sans overflow-hidden">
      {/* Header */}
      <header className="bg-slate-900 text-white p-4 flex justify-between items-center shadow-md z-10 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="relative">
            <Activity className="text-red-500 h-6 w-6" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight">GoldenHour Dispatch</h1>
        </div>
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-3 bg-slate-800 px-4 py-2 rounded-lg border border-slate-700">
            <span className="text-sm font-medium text-slate-300">Mass Casualty Protocol</span>
            <button
              onClick={() => setIsMassCasualty(!isMassCasualty)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${isMassCasualty ? 'bg-red-500' : 'bg-slate-600'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isMassCasualty ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          <div className="text-sm bg-slate-800 px-4 py-2 rounded-lg border border-slate-700 flex items-center gap-2">
            <span className="text-slate-400">Active Units:</span>
            <span className="font-bold text-red-400 text-lg leading-none">{patients.length}</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Triage Input */}
        <div className="w-[380px] bg-[#0B1224] border-r border-white/5 flex flex-col shadow-2xl z-10 shrink-0">

          <div className="p-4 border-b border-white/5 bg-white/5">
            <h2 className="font-semibold text-lg flex items-center gap-2 mb-3">
              <Zap className="h-5 w-5 text-amber-500" />
              Quick Scenarios
            </h2>
            <div className="grid grid-cols-3 gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fillScenario('cardiac')} className="text-xs h-auto py-2 flex flex-col gap-1 border-red-200 hover:bg-red-50 hover:text-red-700">
                <HeartPulse className="h-4 w-4 text-red-500" />
                Cardiac
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => fillScenario('trauma')} className="text-xs h-auto py-2 flex flex-col gap-1 border-orange-200 hover:bg-orange-50 hover:text-orange-700">
                <Car className="h-4 w-4 text-orange-500" />
                Trauma
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => fillScenario('stable')} className="text-xs h-auto py-2 flex flex-col gap-1 border-green-200 hover:bg-green-50 hover:text-green-700">
                <UserCheck className="h-4 w-4 text-green-500" />
                Stable
              </Button>
            </div>
          </div>

          <div className="p-4 overflow-y-auto flex-1">
            <form onSubmit={handleTriageSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="symptoms" className="text-sm font-semibold">Reported Symptoms</Label>
                <Input
                  id="symptoms"
                  placeholder="e.g., Severe chest pain, shortness of breath"
                  value={newPatient.symptoms}
                  onChange={e => setNewPatient({ ...newPatient, symptoms: e.target.value })}
                  required
                  className="bg-white/5 border-white/10 text-white placeholder:text-gray-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4 bg-white/5 p-3 rounded-lg border border-white/10">
                <div className="space-y-1">
                  <Label htmlFor="hr" className="text-xs font-semibold text-slate-600">Heart Rate</Label>
                  <div className="flex items-center gap-2">
                    <Input id="hr" type="number" value={newPatient.hr} onChange={e => setNewPatient({ ...newPatient, hr: parseInt(e.target.value) })} className="h-8" />
                    <span className="text-xs text-slate-400 w-8">bpm</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bp" className="text-xs font-semibold text-slate-600">Blood Pressure</Label>
                  <div className="flex items-center gap-2">
                    <Input id="bp" value={newPatient.bp} onChange={e => setNewPatient({ ...newPatient, bp: e.target.value })} className="h-8" />
                    <span className="text-xs text-slate-400 w-8">mmHg</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="spo2" className="text-xs font-semibold text-slate-600">SpO2</Label>
                  <div className="flex items-center gap-2">
                    <Input id="spo2" type="number" value={newPatient.spo2} onChange={e => setNewPatient({ ...newPatient, spo2: parseInt(e.target.value) })} className="h-8" />
                    <span className="text-xs text-slate-400 w-8">%</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gcs" className="text-xs font-semibold text-slate-600">GCS Score</Label>
                  <div className="flex items-center gap-2">
                    <Input id="gcs" type="number" min="3" max="15" value={newPatient.gcs} onChange={e => setNewPatient({ ...newPatient, gcs: parseInt(e.target.value) })} className="h-8" />
                    <span className="text-xs text-slate-400 w-8">/15</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-blue-500" />
                  Incident Location
                </Label>
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex items-center gap-3 text-sm text-blue-300">
                  <MousePointerClick className="h-5 w-5 text-blue-400 shrink-0 animate-pulse" />
                  <span className="flex-1">Click anywhere on the map to set the incident location.</span>
                </div>
                <div className="grid grid-cols-2 gap-2 opacity-50 pointer-events-none">
                  <Input value={newPatient.lat.toFixed(4)} readOnly className="h-8 text-xs bg-gray-100" />
                  <Input value={newPatient.lng.toFixed(4)} readOnly className="h-8 text-xs bg-gray-100" />
                </div>
              </div>

              <Button type="submit" size="lg" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-md">
                <Navigation className="mr-2 h-4 w-4" />
                Predict Needs & Route Unit
              </Button>
            </form>

            <div className="mt-8">
              <h3 className="font-semibold text-xs text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Active Transports
              </h3>
              <div className="space-y-3">
                <AnimatePresence>
                  {patients.map(p => (
                    <motion.div
                      key={p.id}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                       exit={{ opacity: 0, scale: 0.95 }}
                      onClick={() => handlePatientSelect(p)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all duration-200 ${selectedPatientId === p.id ? 'bg-blue-500/10 border-blue-500 shadow-[0_0_15px_rgba(37,99,235,0.2)]' : 'bg-white/5 hover:bg-white/10 border-white/10'}`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-bold text-sm text-white">Unit {p.id}</span>
                        <Badge variant={p.severity === 'Critical' ? 'destructive' : p.severity === 'Urgent' ? 'warning' : 'success'} className="shadow-sm">
                          {p.severity}
                        </Badge>
                      </div>
                      <div className="text-xs text-gray-400 line-clamp-2 mb-2">{p.symptoms}</div>
                      <div className="text-xs font-semibold text-blue-400 flex items-center gap-1 bg-blue-500/5 p-1.5 rounded border border-blue-500/20">
                        <Navigation className="h-3 w-3 shrink-0" />
                        <span className="truncate">To: {hospitals.find(h => h.id === p.assignedHospitalId)?.name || 'Pending'}</span>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>

        {/* Center - Map */}
        <div className="flex-1 relative z-0 bg-[#f8fafc]">
          <MapContainer center={[18.5204, 73.8567]} zoom={13} className="h-full w-full" zoomControl={false}>
            <TileLayer
              attribution='&copy; Google Maps'
              url="https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
              subdomains={['mt0', 'mt1', 'mt2', 'mt3']}
            />

            {showGrid && <div className="map-grid-overlay" />}
            <div className="map-terrain-effect" />

            <MapEvents onLocationSelect={handleLocationSelect} />
            <MapController center={mapCenter} />
            <MapControls 
              onRecenter={() => setMapCenter([40.75, -73.98])} 
              showGrid={showGrid} 
              setShowGrid={setShowGrid}
              showRoutes={showRoutes}
              setShowRoutes={setShowRoutes}
            />

            {/* New Incident Marker (Preview) */}
            <Marker 
              position={[newPatient.lat, newPatient.lng]} 
              icon={L.divIcon({
                className: 'custom-marker pulse-animation',
                html: `<div class="marker-pin glow-orange"></div><div class="marker-icon-inner"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
              })}
            >
              <Popup>
                <div className="text-orange-600 font-bold">NEW INCIDENT</div>
                <div className="text-xs text-gray-600">Setting location...</div>
              </Popup>
            </Marker>

            {/* Hospital Markers */}
            {hospitals.map(h => {
              const isSelected = selectedPatient?.assignedHospitalId === h.id;
              const loadColor = h.load > 90 ? 'glow-red' : h.load > 70 ? 'glow-orange' : 'glow-green';
              
              return (
                <Marker 
                  key={h.id} 
                  position={[h.lat, h.lng]} 
                  icon={L.divIcon({
                    className: `custom-marker ${isSelected ? 'pulse-animation' : ''}`,
                    html: `
                      <div class="marker-label" style="background: ${isSelected ? '#1e293b' : 'white'}; color: ${isSelected ? 'white' : '#1e293b'}; border: 2px solid ${isSelected ? '#3b82f6' : 'rgba(0,0,0,0.1)'}">${h.name}</div>
                      <div class="marker-pin ${loadColor}"></div>
                      <div class="marker-icon-inner"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg></div>
                      ${isSelected ? '<div class="absolute -inset-4 rounded-full border-4 border-blue-500/30 animate-ping"></div>' : ''}
                    `,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                  })}
                  zIndexOffset={isSelected ? 1000 : 0}
                >
                  <Popup className="light-popup">
                    <div className="font-bold text-slate-900 mb-1">{h.name}</div>
                    <div className="text-xs text-slate-500 mb-2">Level {h.level} Trauma Center</div>
                    <div className="space-y-1 text-xs bg-slate-50 p-2 rounded border border-slate-200">
                      <div className="flex justify-between">
                        <span className="text-slate-500">ICU:</span>
                        <span className="font-semibold text-slate-900">{h.icuAvailable}/{h.icuTotal}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Load:</span>
                        <span className={`font-bold ${h.load > 90 ? 'text-red-600' : h.load > 70 ? 'text-orange-600' : 'text-green-600'}`}>{h.load}%</span>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}

            {/* Patient Markers & Routes */}
            {patients.map(p => {
              const targetHospital = hospitals.find(h => h.id === p.assignedHospitalId);
              const isSelected = p.id === selectedPatientId;
              const severityColor = p.severity === 'Critical' ? '#ef4444' : p.severity === 'Urgent' ? '#f97316' : '#10b981';
              const glowClass = p.severity === 'Critical' ? 'glow-red' : p.severity === 'Urgent' ? 'glow-orange' : 'glow-green';
              
              return (
                <React.Fragment key={p.id}>
                  {/* Start Point Marker (Incident) */}
                  {isSelected && (
                    <Marker 
                      position={[p.lat, p.lng]} 
                      icon={L.divIcon({
                        className: 'custom-marker',
                        html: `<div class="w-4 h-4 bg-slate-900 rounded-full border-2 border-white shadow-lg"></div>`,
                        iconSize: [16, 16],
                        iconAnchor: [8, 8]
                      })}
                    />
                  )}

                  <Marker 
                    position={[p.lat, p.lng]} 
                    icon={L.divIcon({
                      className: `custom-marker ${isSelected ? 'pulse-animation' : ''}`,
                      html: `
                        <div class="marker-label" style="background: #ef4444; color: white;">AMB-${p.id.toUpperCase()}</div>
                        <div class="marker-pin ${glowClass}"></div>
                        <div class="marker-icon-inner"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14h4"/><path d="M12 12v4"/><path d="M19 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="M10 18H5a2 2 0 0 1-2-2V7c0-1.1.9-2 2-2h3l3 4h6a2 2 0 0 1 2 2v4"/><path d="M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg></div>
                      `,
                      iconSize: [30, 30],
                      iconAnchor: [15, 15]
                    })}
                    zIndexOffset={isSelected ? 1000 : 0}
                  >
                    <Popup>
                      <div className={`font-bold ${p.severity === 'Critical' ? 'text-red-600' : 'text-orange-600'}`}>UNIT ${p.id}</div>
                      <div className="text-xs text-slate-600">ETA: {p.eta} mins</div>
                    </Popup>
                  </Marker>

                  {targetHospital && showRoutes && (
                    <>
                      {/* Glow path */}
                      <Polyline
                        positions={[[p.lat, p.lng], [targetHospital.lat, targetHospital.lng]]}
                        color={severityColor}
                        weight={isSelected ? 10 : 4}
                        opacity={0.15}
                        className="route-glow"
                      />
                      {/* Main path */}
                      <Polyline
                        positions={[[p.lat, p.lng], [targetHospital.lat, targetHospital.lng]]}
                        color={severityColor}
                        weight={isSelected ? 4 : 2}
                        dashArray={isSelected ? "10, 10" : "5, 5"}
                        className={`route-flow ${isSelected ? 'route-pulse' : ''}`}
                      />
                    </>
                  )}
                </React.Fragment>
              );
            })}
          </MapContainer>

          {/* Floating Map Overlays */}
          <div className="absolute top-6 left-6 z-[500] flex flex-col gap-3 pointer-events-none">
            <motion.div 
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              className="map-overlay-card px-5 py-3 rounded-2xl flex items-center gap-4 neon-border-red border-l-4"
            >
              <div className="relative">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                <div className="absolute inset-0 bg-red-500 blur-md opacity-20 animate-pulse"></div>
              </div>
              <div className="flex flex-col">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-red-500/80 leading-none mb-1">Alert Status</div>
                <div className="text-sm font-bold tracking-tight text-white">HIGH ALERT: SYSTEM OVERLOAD</div>
              </div>
            </motion.div>
            
            <div className="flex gap-3">
              {hospitals.slice(0, 3).map((h, i) => (
                <motion.div 
                  key={h.id}
                  initial={{ y: -10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.1 * i }}
                  className="map-overlay-card p-3 rounded-xl flex flex-col gap-2 min-w-[120px] group"
                >
                  <div className="flex justify-between items-start">
                    <div className="text-[10px] uppercase text-gray-400 font-black tracking-wider truncate w-20">{h.name}</div>
                    <div className={`h-2 w-2 rounded-full ${h.load > 90 ? 'bg-red-500 shadow-[0_0_8px_#ef4444]' : 'bg-emerald-500 shadow-[0_0_8px_#10b981]'} transition-all group-hover:scale-125`} />
                  </div>
                  <div className="flex items-end justify-between">
                    <div className="text-lg font-black leading-none">{h.load}<span className="text-[10px] ml-0.5 opacity-60">%</span></div>
                    <div className="text-[9px] font-bold text-gray-500 uppercase">Load</div>
                  </div>
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${h.load > 90 ? 'bg-red-500' : 'bg-emerald-500'} transition-all duration-1000`} 
                      style={{ width: `${h.load}%` }}
                    />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="absolute bottom-6 left-6 z-[500] pointer-events-none">
             <motion.div 
               initial={{ y: 20, opacity: 0 }}
               animate={{ y: 0, opacity: 1 }}
               className="map-overlay-card px-5 py-3 rounded-2xl flex items-center gap-4"
             >
                <div className="flex -space-x-3">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="h-8 w-8 rounded-full border-2 border-[#1e293b] bg-slate-800 flex items-center justify-center shadow-lg">
                      <UserCheck className="h-4 w-4 text-blue-400" />
                    </div>
                  ))}
                </div>
                <div className="flex flex-col">
                  <div className="text-lg font-black text-white leading-none">12 Units</div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Active in Region</div>
                </div>
             </motion.div>
          </div>

          {/* Map Overlay Hint */}
          <div className="absolute top-6 right-6 z-[500] pointer-events-auto">
            <Button 
              onClick={() => setIsLiveMode(!isLiveMode)}
              className={`${isLiveMode ? 'bg-blue-600/20 border-blue-500/50 text-blue-400 shadow-[0_0_30px_rgba(37,99,235,0.25)]' : 'bg-slate-900/50 border-white/10 text-gray-500 shadow-none'} backdrop-blur-xl px-6 py-6 rounded-2xl border text-sm font-black flex items-center gap-3 transition-all hover:scale-105 active:scale-95 group`}
            >
              <div className="relative">
                <Zap className={`h-5 w-5 ${isLiveMode ? 'fill-blue-400 group-hover:animate-bounce' : 'fill-gray-600'}`} />
                {isLiveMode && <div className="absolute inset-0 bg-blue-400 blur-lg opacity-40 animate-pulse"></div>}
              </div>
              <div className="flex flex-col items-start leading-none">
                <span className="text-[10px] uppercase tracking-[0.2em] opacity-70 mb-1">System Mode</span>
                <span className="tracking-widest font-black">{isLiveMode ? 'LIVE DISPATCH' : 'PAUSED'}</span>
              </div>
            </Button>
          </div>
        </div>

        {/* Right Sidebar - Routing Explainability & Hospital Status */}
        <div className="w-[400px] bg-[#0B1224] border-l border-white/5 flex flex-col shadow-2xl z-10 shrink-0">

          {/* Explainability Panel */}
          <div className="p-5 border-b border-white/5 bg-white/5 flex-1 overflow-y-auto">
            <h2 className="font-semibold text-lg flex items-center gap-2 mb-5 text-white">
              <Navigation className="h-5 w-5 text-blue-600" />
              Routing Intelligence
            </h2>

            <AnimatePresence mode="wait">
              {selectedPatient ? (
                <motion.div
                  key={selectedPatient.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-5"
                >
                  <Card className="border-blue-500/30 bg-blue-500/5 shadow-lg overflow-hidden">
                    <CardHeader className="pb-3 bg-blue-500/10 border-b border-blue-500/20">
                      <CardTitle className="text-sm flex justify-between items-center">
                        <span className="font-bold text-blue-100">Predicted Care Needs</span>
                        <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30 shadow-sm">{selectedPatient.severity}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                      <div className="flex flex-wrap gap-2">
                        {selectedPatient.predictedNeeds.map((need, i) => (
                          <Badge key={i} variant="secondary" className="bg-indigo-50 text-indigo-700 border-indigo-200 px-3 py-1">
                            {need}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-green-500/30 bg-green-500/5 shadow-lg overflow-hidden">
                    <CardHeader className="pb-3 bg-green-500/10 border-b border-green-500/20">
                      <CardTitle className="text-sm flex items-center gap-2 text-green-100">
                        <CheckCircle2 className="h-5 w-5 text-green-400" />
                        Optimal Destination
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4 space-y-4">
                      <div className="flex justify-between items-start bg-white/5 p-3 rounded-lg border border-green-500/20 shadow-inner">
                        <div className="font-bold text-lg text-white">
                          {hospitals.find(h => h.id === selectedPatient.assignedHospitalId)?.name}
                        </div>
                        <div className="flex items-center text-green-400 font-bold bg-green-500/20 px-3 py-1.5 rounded-md text-sm shadow-sm border border-green-500/30">
                          <Clock className="h-4 w-4 mr-1.5" />
                          {selectedPatient.eta} min
                        </div>
                      </div>

                      <div className="bg-slate-800 p-4 rounded-lg text-sm text-slate-300 leading-relaxed shadow-inner relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                        <span className="font-bold block mb-2 text-white flex items-center gap-2">
                          <Activity className="h-4 w-4 text-blue-400" />
                          Constraint Engine Rationale:
                        </span>
                        {selectedPatient.routingRationale}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center text-gray-400 py-12 flex flex-col items-center bg-white rounded-xl border border-dashed border-gray-200"
                >
                  <MapPin className="h-10 w-10 text-gray-300 mb-3" />
                  <p className="font-medium">Select a unit to view routing rationale.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Live Hospital Grid */}
          <div className="p-5 flex-1 overflow-y-auto bg-white/5">
            <h2 className="font-semibold text-lg flex items-center gap-2 mb-4 text-white">
              <Activity className="h-5 w-5 text-red-500" />
              Live Regional Grid
            </h2>

            <div className="space-y-3">
              {hospitals.map(h => (
                <div key={h.id} className="border border-white/10 rounded-xl p-4 text-sm shadow-lg hover:shadow-xl transition-all hover:bg-white/10 bg-white/5">
                  <div className="flex justify-between items-center mb-3">
                    <span className="font-bold text-gray-100">{h.name}</span>
                    <Badge variant={h.load > 90 ? 'destructive' : h.load > 70 ? 'warning' : 'success'} className="shadow-sm">
                      {h.load}% Load
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs text-gray-400 mb-3 bg-black/20 p-2 rounded-lg border border-white/5">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full shadow-sm ${h.icuAvailable > 0 ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="font-medium">ICU: {h.icuAvailable}/{h.icuTotal}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full shadow-sm ${h.ventsAvailable > 0 ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="font-medium">Vents: {h.ventsAvailable}/{h.ventsTotal}</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {h.hasNeuro && <Badge variant="outline" className="text-[10px] py-0 h-5 bg-white">Neuro</Badge>}
                    {h.hasCathLab && <Badge variant="outline" className="text-[10px] py-0 h-5 bg-white">Cath Lab</Badge>}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
