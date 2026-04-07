/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  query, 
  where, 
  orderBy, 
  Timestamp,
  getDocFromServer,
  deleteDoc
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User,
  signOut
} from 'firebase/auth';
import { db, auth } from './firebase';
import { format, differenceInMinutes } from 'date-fns';
import { 
  Clock, 
  Users, 
  Plus, 
  LogIn, 
  LogOut, 
  UserPlus, 
  Timer,
  CheckCircle2,
  AlertCircle,
  Search,
  Coffee
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface Employee {
  id: string;
  name: string;
  createdAt: Timestamp;
}

interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string; // YYYY-MM-DD
  startTime: Timestamp;
  endTime?: Timestamp;
  durationMinutes?: number;
  type: 'work' | 'break';
  status: 'present' | 'late' | 'completed';
  parentSessionId?: string;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

// --- Error Handling ---
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}

// --- Components ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState<'attendance' | 'employees' | 'clock'>('clock');
  
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [allowedIntervalMinutes, setAllowedIntervalMinutes] = useState(20);
  const [currentTime, setCurrentTime] = useState(new Date());

  // --- Real-time Clock ---
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 5000); // Update every 5 seconds for more responsive alerts
    return () => clearInterval(timer);
  }, []);

  // --- Auth ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed', error);
    }
  };

  const handleLogout = () => signOut(auth);

  // --- Connection Test ---
  useEffect(() => {
    if (isAuthReady && user) {
      const testConnection = async () => {
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (error) {
          if (error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Please check your Firebase configuration.");
          }
        }
      };
      testConnection();
    }
  }, [isAuthReady, user]);

  // --- Data Listeners ---
  useEffect(() => {
    if (!isAuthReady || !user) return;

    setLoading(true);

    const employeesUnsubscribe = onSnapshot(
      collection(db, 'employees'),
      (snapshot) => {
        const emps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
        setEmployees(emps);
        setLoading(false);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'employees')
    );

    const attendanceUnsubscribe = onSnapshot(
      query(collection(db, 'attendance'), orderBy('startTime', 'desc')),
      (snapshot) => {
        const atts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AttendanceRecord));
        setAttendance(atts);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'attendance')
    );

    return () => {
      employeesUnsubscribe();
      attendanceUnsubscribe();
    };
  }, [isAuthReady, user]);

  // --- Actions ---
  const addEmployee = async (name: string) => {
    try {
      await addDoc(collection(db, 'employees'), {
        name,
        createdAt: Timestamp.now()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'employees');
    }
  };

  const clockIn = async (employeeId: string, employeeName: string) => {
    const now = new Date();
    const today = format(now, 'yyyy-MM-dd');
    
    try {
      await addDoc(collection(db, 'attendance'), {
        employeeId,
        employeeName,
        date: today,
        startTime: Timestamp.now(),
        type: 'work',
        status: 'present'
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'attendance');
    }
  };

  const startBreak = async (employeeId: string, employeeName: string, mainSessionId: string) => {
    const today = format(new Date(), 'yyyy-MM-dd');
    try {
      await addDoc(collection(db, 'attendance'), {
        employeeId,
        employeeName,
        date: today,
        startTime: Timestamp.now(),
        type: 'break',
        status: 'present',
        parentSessionId: mainSessionId
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'attendance');
    }
  };

  const endBreak = async (breakRecordId: string, startTime: Timestamp) => {
    const now = new Date();
    const duration = differenceInMinutes(now, startTime.toDate());
    const status = duration > allowedIntervalMinutes ? 'late' : 'completed';

    try {
      await updateDoc(doc(db, 'attendance', breakRecordId), {
        endTime: Timestamp.now(),
        durationMinutes: duration,
        status: status
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `attendance/${breakRecordId}`);
    }
  };

  const clockOut = async (workRecordId: string, startTime: Timestamp) => {
    const now = new Date();
    const duration = differenceInMinutes(now, startTime.toDate());
    try {
      await updateDoc(doc(db, 'attendance', workRecordId), {
        endTime: Timestamp.now(),
        durationMinutes: duration,
        status: 'completed'
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `attendance/${workRecordId}`);
    }
  };

  const resetAttendance = async (employeeId: string) => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const recordsToDelete = attendance.filter(a => a.employeeId === employeeId && a.date === today);
    
    try {
      for (const record of recordsToDelete) {
        await deleteDoc(doc(db, 'attendance', record.id));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `attendance/reset/${employeeId}`);
    }
  };

  const isAdmin = user?.email === "rockdeva.kasc@gmail.com";

  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => 
      emp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.department.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [employees, searchTerm]);

  // --- UI Helpers ---
  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <motion.div 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }}
          className="text-slate-400 font-medium"
        >
          Loading TimeTrack Pro...
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 text-center space-y-6">
          <div className="w-20 h-20 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto">
            <Clock className="w-10 h-10 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">TimeTrack Pro</h1>
            <p className="text-slate-500 mt-2">Manage your team's time with ease</p>
          </div>
          <button
            onClick={handleLogin}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2"
          >
            <LogIn className="w-5 h-5" />
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-10 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Clock className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-bold text-slate-900 text-lg">TimeTrack</h1>
        </div>
        <button 
          onClick={handleLogout}
          className="p-2 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto p-6">
        <AnimatePresence mode="wait">
          {activeTab === 'clock' && (
            <motion.div
              key="clock"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <section className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                    <Timer className="w-5 h-5 text-indigo-600" />
                    Clock In / Out
                  </h2>
                  <div className="flex flex-wrap items-center gap-3 bg-slate-50 px-4 py-3 rounded-2xl border border-slate-100">
                    <div className="flex items-center gap-2">
                      <Timer className="w-4 h-4 text-slate-400" />
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Interval (min):</label>
                      <input 
                        type="number" 
                        value={allowedIntervalMinutes}
                        onChange={(e) => setAllowedIntervalMinutes(parseInt(e.target.value) || 0)}
                        className="bg-transparent text-sm font-bold text-indigo-600 outline-none w-10"
                      />
                    </div>
                  </div>
                </div>
                
                {employees.length === 0 ? (
                  <div className="text-center py-8 space-y-4">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto">
                      <Users className="w-8 h-8 text-slate-400" />
                    </div>
                    <p className="text-slate-500">No employees added yet.</p>
                    <button 
                      onClick={() => setActiveTab('employees')}
                      className="text-indigo-600 font-semibold hover:underline"
                    >
                      Add your first employee
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {employees.map((emp) => {
                      const today = format(new Date(), 'yyyy-MM-dd');
                      const records = attendance.filter(a => a.employeeId === emp.id && a.date === today);
                      const activeWorkSession = records.find(r => r.type === 'work' && !r.endTime);
                      const activeBreakSession = records.find(r => r.type === 'break' && !r.endTime);
                      const lastCompletedBreak = records.filter(r => r.type === 'break' && r.endTime).sort((a,b) => b.startTime.toMillis() - a.startTime.toMillis())[0];

                      const breakElapsedMinutes = activeBreakSession 
                        ? differenceInMinutes(currentTime, activeBreakSession.startTime.toDate())
                        : 0;
                      const isBreakExceeded = activeBreakSession && breakElapsedMinutes > allowedIntervalMinutes;

                      return (
                        <div key={emp.id} className={`flex flex-col p-4 rounded-2xl border transition-all duration-500 relative overflow-hidden ${isBreakExceeded ? 'bg-rose-50 border-rose-500 shadow-xl shadow-rose-200 ring-2 ring-rose-500 ring-opacity-50' : 'bg-slate-50 border-slate-100'} gap-4`}>
                          {isBreakExceeded && (
                            <motion.div 
                              initial={{ x: 100 }}
                              animate={{ x: 0 }}
                              className="absolute top-0 right-0 bg-rose-600 text-white text-[10px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-tighter z-10"
                            >
                              Late Break
                            </motion.div>
                          )}
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-bold text-slate-900">{emp.name}</p>
                            </div>
                            {isAdmin && records.length > 0 && (
                              <button
                                onClick={() => resetAttendance(emp.id)}
                                className="p-2 text-slate-400 hover:text-rose-500 transition-colors"
                                title="Reset all records for today"
                              >
                                <AlertCircle className="w-5 h-5" />
                              </button>
                            )}
                          </div>
                          
                          <div className="flex flex-wrap gap-2">
                            {!activeWorkSession ? (
                              <button
                                onClick={() => clockIn(emp.id, emp.name)}
                                className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2"
                              >
                                <LogIn className="w-4 h-4" />
                                Clock In
                              </button>
                            ) : activeBreakSession ? (
                              <button
                                onClick={() => endBreak(activeBreakSession.id, activeBreakSession.startTime)}
                                className="flex-1 px-4 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                                End Break
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => startBreak(emp.id, emp.name, activeWorkSession.id)}
                                  className="flex-1 px-4 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2"
                                >
                                  <Coffee className="w-4 h-4" />
                                  Go on Break
                                </button>
                                <button
                                  onClick={() => clockOut(activeWorkSession.id, activeWorkSession.startTime)}
                                  className="flex-1 px-4 py-3 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2"
                                >
                                  <LogOut className="w-4 h-4" />
                                  Clock Out
                                </button>
                              </>
                            )}
                          </div>

                          {/* Status Info */}
                          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
                            <div className="flex gap-3">
                              {activeWorkSession && !activeBreakSession && (
                                <span className="text-indigo-600 flex items-center gap-1">
                                  <div className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-pulse" />
                                  Working
                                </span>
                              )}
                              {activeBreakSession && (
                                <span className={`${isBreakExceeded ? 'text-rose-600 animate-bounce' : 'text-amber-600'} flex items-center gap-1`}>
                                  <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${isBreakExceeded ? 'bg-rose-600' : 'bg-amber-600'}`} />
                                  {isBreakExceeded ? `TIME EXCEEDED (${breakElapsedMinutes}m)` : `On Break (${breakElapsedMinutes}m)`}
                                </span>
                              )}
                            </div>
                            {lastCompletedBreak && (
                              <span className={`${lastCompletedBreak.status === 'late' ? 'text-rose-600' : 'text-emerald-600'}`}>
                                Last Break: {lastCompletedBreak.durationMinutes}m {lastCompletedBreak.status === 'late' && '(LATE)'}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </motion.div>
          )}

          {activeTab === 'attendance' && (
            <motion.div
              key="attendance"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <section className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6">
                <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  Currently Active
                </h2>
                
                <div className="space-y-4">
                  {attendance.filter(r => !r.endTime).length === 0 ? (
                    <div className="text-center py-12 space-y-3">
                      <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
                        <Users className="w-6 h-6" />
                      </div>
                      <p className="text-slate-400">No employees are currently active.</p>
                    </div>
                  ) : (
                    attendance.filter(r => !r.endTime).map((record) => (
                      <div key={record.id} className={`flex items-center justify-between p-4 rounded-2xl border ${record.type === 'break' ? 'bg-amber-50 border-amber-100' : 'bg-emerald-50/50 border-emerald-100'}`}>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-slate-900">{record.employeeName}</p>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${record.type === 'break' ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                              {record.type}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-slate-500 mt-1">
                            <LogIn className="w-3.5 h-3.5" />
                            <span>Started at {format(record.startTime.toDate(), 'HH:mm')}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-xs font-bold uppercase tracking-widest mb-1 ${record.type === 'break' ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {record.type === 'break' ? 'On Break' : 'Working'}
                          </div>
                          <div className="text-xs text-slate-400">{record.date}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </motion.div>
          )}

          {activeTab === 'employees' && (
            <motion.div
              key="employees"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <AddEmployeeForm onAdd={addEmployee} />
              
              <section className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-600" />
                    Employee List
                  </h2>
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input 
                      type="text"
                      placeholder="Search employees..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all w-full sm:w-64"
                    />
                  </div>
                </div>
                <div className="space-y-4">
                  {filteredEmployees.map((emp) => (
                    <div key={emp.id} className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600 font-bold">
                        {emp.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-bold text-slate-900">{emp.name}</p>
                        <p className="text-xs text-slate-400">Registered {format(emp.createdAt.toDate(), 'MMM d, yyyy')}</p>
                      </div>
                    </div>
                  ))}
                  {filteredEmployees.length === 0 && (
                    <p className="text-center text-slate-400 py-8">
                      {searchTerm ? 'No employees match your search.' : 'No employees yet.'}
                    </p>
                  )}
                </div>
              </section>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-3 flex justify-around items-center z-10">
        <NavButton 
          active={activeTab === 'attendance'} 
          onClick={() => setActiveTab('attendance')}
          icon={<Users className="w-6 h-6" />}
          label="Present"
        />
        <NavButton 
          active={activeTab === 'clock'} 
          onClick={() => setActiveTab('clock')}
          icon={<Clock className="w-6 h-6" />}
          label="Clock"
        />
        <NavButton 
          active={activeTab === 'employees'} 
          onClick={() => setActiveTab('employees')}
          icon={<Users className="w-6 h-6" />}
          label="Team"
        />
      </nav>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center gap-1 transition-all ${active ? 'text-indigo-600' : 'text-slate-400'}`}
    >
      <div className={`p-2 rounded-xl transition-all ${active ? 'bg-indigo-50' : ''}`}>
        {icon}
      </div>
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
    </button>
  );
}

function AddEmployeeForm({ onAdd }: { onAdd: (n: string) => void }) {
  const [name, setName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    onAdd(name);
    setName('');
  };

  return (
    <section className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6">
      <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
        <UserPlus className="w-5 h-5 text-indigo-600" />
        Add New Employee
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1">Full Name</label>
          <input 
            type="text" 
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
            placeholder="John Doe"
          />
        </div>
        <button 
          type="submit"
          className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-200"
        >
          <Plus className="w-5 h-5" />
          Register Employee
        </button>
      </form>
    </section>
  );
}
