/* ============================================================================
   SEED — Dados iniciais para o localStorage
   ============================================================================

   Este script pode ser executado no console do navegador para popular
   o localStorage com dados de exemplo, ou pode ser carregado
   automaticamente na primeira visita.

   Como usar:
   1. Abra o console do navegador (F12)
   2. Cole e execute este código
   3. Os dados serão criados automaticamente (se não existirem)

   Ou importe no ui.js para executar automaticamente na primeira visita.
   ============================================================================ */

(function seedLocalStorage() {
  console.log('🌱 Seed: Verificando se há dados no localStorage...');

  // ========== VERIFICA SE JÁ EXISTEM DADOS ==========
  const usuariosExistentes = localStorage.getItem('bp_usuarios');
  if (usuariosExistentes && JSON.parse(usuariosExistentes).length > 0) {
    console.log('✅ Seed: Dados já existentes. Nada a fazer.');
    return;
  }

  console.log('🌱 Seed: Populando localStorage com dados de exemplo...');

  // ========== USUÁRIOS ==========
  const usuarios = [
    {
      id: 1001,
      nome: 'João Osvaldo',
      email: 'joao@yahoo.com',
      senhaHash: btoa('123456'), // Base64 de '123456' (apenas para demonstração)
      papel: 'cliente',
      avatar: 'assets/img/avatar-exemplo.jpg',
      criadoEm: new Date().toISOString(),
      ativo: true
    },
    {
      id: 1002,
      nome: 'Barbeiro Admin',
      email: 'equipe@barbearprime.com',
      senhaHash: btoa('admin123'),
      papel: 'equipe',
      avatar: 'assets/img/avatar-exemplo.jpg',
      criadoEm: new Date().toISOString(),
      ativo: true
    },
    {
      id: 1003,
      nome: 'Ana Silva',
      email: 'ana@email.com',
      senhaHash: btoa('senha123'),
      papel: 'cliente',
      avatar: 'assets/img/avatar-exemplo.jpg',
      criadoEm: new Date().toISOString(),
      ativo: true
    }
  ];

  // ========== AGENDAMENTOS ==========
  const agendamentos = [
    {
      id: 2001,
      usuarioId: 1001,
      usuarioNome: 'João Osvaldo',
      servicoIds: ['1', '3'],
      data: '2026-09-15',
      hora: '14:00',
      status: 'confirmado',
      criadoEm: new Date().toISOString()
    },
    {
      id: 2002,
      usuarioId: 1001,
      usuarioNome: 'João Osvaldo',
      servicoIds: ['2'],
      data: '2026-09-20',
      hora: '10:00',
      status: 'pendente',
      criadoEm: new Date().toISOString()
    },
    {
      id: 2003,
      usuarioId: 1003,
      usuarioNome: 'Ana Silva',
      servicoIds: ['4', '5'],
      data: '2026-09-18',
      hora: '16:00',
      status: 'pendente',
      criadoEm: new Date().toISOString()
    }
  ];

  // ========== PREFERÊNCIAS DE CORTE ==========
  const preferencias = {
    1001: {
      tamanho_cabelo: 'medio',
      tipo_degrade: 'navalhado',
      acabamento: 'arredondado',
      estilo_barba: 'longa_cheia',
      notas: 'Prefiro a nuca bem alinhada e o contorno da barba mais fechado.'
    },
    1003: {
      tamanho_cabelo: 'longo',
      tipo_degrade: 'sombreado',
      acabamento: 'natural',
      estilo_barba: 'feita_rasa',
      notas: 'Gosto de um visual mais natural.'
    }
  };

  // ========== SALVAR NO LOCALSTORAGE ==========
  try {
    localStorage.setItem('bp_usuarios', JSON.stringify(usuarios));
    console.log('✅ Usuários salvos:', usuarios.length);

    localStorage.setItem('bp_agendamentos', JSON.stringify(agendamentos));
    console.log('✅ Agendamentos salvos:', agendamentos.length);

    localStorage.setItem('bp_preferencias_corte', JSON.stringify(preferencias));
    console.log('✅ Preferências de corte salvas:', Object.keys(preferencias).length);

    console.log('🌱 Seed concluído com sucesso!');
    console.log('📋 Credenciais de teste:');
    console.log('   Cliente: joao@yahoo.com / 123456');
    console.log('   Equipe: equipe@barbearprime.com / admin123');
    console.log('   Cliente 2: ana@email.com / senha123');
  } catch (e) {
    console.error('❌ Erro ao salvar seed:', e);
  }
})();